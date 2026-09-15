/**
 * 修改时间：2026-09-15
 * 文件说明：VaultAgent D9 受限多步问答 Run 与事件持久化。
 *
 * 此文件固定一次问答的资料快照、公开阶段事件和最终回答；Agent 只负责受限证据
 * 收集；未调用工具时直接保存 Agent 回答，调用工具后由独立生成器输出最终答案。
 *
 * edit by：Sliye
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { gateway, parsePartialJson, streamText } from "ai";
import { createVaultRunAgent } from "@/lib/agent/run-agent";
import { createVaultRunState } from "@/lib/agent/run-state";
import { getDatabase } from "@/lib/db/client";
import { conversations, messages, runEvents, runs } from "@/lib/db/schema";
import { LOCAL_WORKSPACE_ID } from "@/lib/ingestion/imports";
import { getLatestPublishedSnapshot } from "@/lib/retrieval/search";
import { readSnapshotSources } from "@/lib/sources/reader";
import type { SourceCitation } from "@/lib/sources/types";
/** Agent 与最终回答共同使用的已验证主模型。 */
const CHAT_MODEL = "alibaba/qwen3.7-flash";
/** 最终回答输出上限，避免上下文与费用无界增长。 */
const MAX_OUTPUT_TOKENS = 1_200;
/** 文本增量写入事件库的最短时间窗口，避免逐 token 写库。 */
const EVENT_FLUSH_INTERVAL_MS = 300;
/** 同一 Node 执行内串行化同一 Run 的事件写入，避免流式写库占用相同 sequence。 */
const pendingEventWrites = new Map<string, Promise<void>>();

/** 给前端展示的引用信息，引用必须来自 Agent 实际读取的证据。 */
export type ChatCitation = SourceCitation;

/** 公开的工具活动摘要，不包含模型参数、来源正文或私密思维。 */
export type ChatToolActivity = {
  toolCallId: string;
  toolName: string;
  status: "started" | "completed" | "failed";
  message: string;
};

/** 公开阶段文本的流式更新；stageId 用于前端把同一段增量合并为一行。 */
export type ChatStageUpdate = {
  stageId: string;
  delta: string;
  status: "active" | "complete";
};

// 一次问答执行的身份信息
export type ChatRun = {
  conversationId: string;
  runId: string;
  snapshotId: string; //本次问答使用哪个知识库快照
};
// 推送给浏览器的事件类型
export type ChatStreamEvent =
  | { type: "stage"; data: ChatStageUpdate }
  | { type: "tool"; data: ChatToolActivity }
  | { type: "delta"; data: { text: string; provisional?: boolean } } // 未确定是否调用工具的文字也实时展示
  | { type: "answer-stage"; data: { stages: ChatStageUpdate[] } }
  | { type: "complete"; data: { citations: ChatCitation[] } }; //完成事件，包含引用信息

/**
 * 创建单轮问答 Run，开始后始终固定在当前已发布快照上。
 *
 * @param question 已校验的用户问题。
 * @param conversationId 可选的既有会话标识；未提供时创建新会话。
 */
export async function createChatRun(question: string, conversationId?: string): Promise<ChatRun> {
  const snapshot = await getLatestPublishedSnapshot(LOCAL_WORKSPACE_ID);
  if (!snapshot) throw new Error("请先完成一个 Markdown 文件的导入，再开始提问。");

  const db = getDatabase();
  const runId = randomUUID();
  //如果前端传了 conversationId 就使用前端传的，如果没有就生成一个新的就是新绘画
  const resolvedConversationId = conversationId ?? randomUUID();

  //验证会话是否有效，验证会话ID是否存在，是否属于当前工作区，是否未被删除
  if (conversationId) {
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.workspaceId, LOCAL_WORKSPACE_ID),
          isNull(conversations.deletedAt),
        ),
      )
      .limit(1);
    if (!conversation) throw new Error("目标会话不存在或已经删除。");
  }

  //使用事务同时写入四类数据
  await db.transaction(async (transaction) => {
    //如果没有传入 conversationId 就创建一个新的会话
    if (!conversationId) {
      await transaction.insert(conversations).values({
        id: resolvedConversationId,
        workspaceId: LOCAL_WORKSPACE_ID,
        title: makeConversationTitle(question),//标题通过问题直接生成 暂时这样 后续可能会接入一个模型生成
      });
    }
    //创建运行记录
    await transaction.insert(runs).values({
      id: runId,
      conversationId: resolvedConversationId,
      snapshotId: snapshot.id,
      status: "running",
    });

    //保存用户消息
    await transaction.insert(messages).values({
      id: randomUUID(),
      conversationId: resolvedConversationId,
      runId,
      role: "user",
      content: question,
      status: "completed",
      citations: [],
    });
    //写入开始事件
    await transaction.insert(runEvents).values({
      id: randomUUID(),
      runId,
      sequence: 1,
      eventType: "run_started",
      payload: { message: "正在检索当前知识库" },
    });
  });

  return { conversationId: resolvedConversationId, runId, snapshotId: snapshot.id };
}

/**
 * 未调用工具时直接完成回答；调用工具后执行受限证据收集与独立最终生成。
 *
 * @param chatRun 已持久化的单轮问答 Run。
 * @param question 已保存的用户问题。
 * 
 * async function* 很关键，它是一个异步生成器，可以不断的产生事件返回给前端
 * yield 阶段消息
 * yield 文本片段增量
 * yield 完成事件
 * APi层通过这个循环可以把事件发送给浏览器消费，详情可以看 api/chat/route.ts
 */
export async function* executeChatRun(
  chatRun: ChatRun,
  question: string,
): AsyncGenerator<ChatStreamEvent> {
  try {
    const state = createVaultRunState(chatRun.snapshotId, {
      onRetrievalTrace: (trace) => appendRunEvent(
        chatRun.runId,
        "retrieval_trace",
        trace,
      ),
    });
    const agent = createVaultRunAgent(state);
    const agentResult = await agent.stream({ prompt: question });
    const toolInputStreams = new Map<
      string,
      { json: string; briefing: string }
    >();
    const textStreams = new Map<string, string>();
    /** 首段实时展示；首次调用工具后将已展示文字转入过程区。 */
    let hasUsedTools = false;
    /** 首段正文按时间窗口保存，SSE 仍逐模型增量推送。 */
    let pendingInitialText = "";
    let lastInitialFlushAt = Date.now();
    /** 区分尚未检索与检索后无证据，避免最终回答伪称查过知识库。 */
    let hasSearched = false;
    /** 无证据且工具失败时仍保留异常，不能把服务故障包装成普通无答案。 */
    let hasToolError = false;

    // fullStream 同时提供模型文本和工具参数增量；只发布公开文本，不读取 reasoning。
    for await (const part of agentResult.fullStream) {
      if (!hasUsedTools && (part.type === "tool-input-start" || part.type === "tool-call")) {
        hasUsedTools = true;
        if (pendingInitialText) {
          await appendRunEvent(chatRun.runId, "provisional_delta", { text: pendingInitialText });
          pendingInitialText = "";
        }
        const stages: ChatStageUpdate[] = [...textStreams].flatMap(([id, text]) => {
          const delta = text.slice(0, 800).trim();
          return delta ? [{ stageId: `text:${id}`, delta, status: "complete" as const }] : [];
        });
        if (textStreams.size) {
          // 持久化归类事件，在线展示和回放都清除临时正文，再归入工具前的阶段。
          await appendRunEvent(chatRun.runId, "answer_to_stage", { stages });
          yield { type: "answer-stage", data: { stages } };
        }
        textStreams.clear();
      }
      if (part.type === "text-start") {
        textStreams.set(part.id, "");
      }
      if (part.type === "text-delta") {
        const stageId = `text:${part.id}`;
        const current = textStreams.get(part.id) ?? "";
        const delta = hasUsedTools
          ? part.text.slice(0, Math.max(0, 800 - current.length))
          : part.text;
        if (delta) {
          textStreams.set(part.id, current + delta);
          if (hasUsedTools) {
            yield createStageUpdate(stageId, delta, "active");
          } else {
            pendingInitialText += delta;
            if (Date.now() - lastInitialFlushAt >= EVENT_FLUSH_INTERVAL_MS) {
              await appendRunEvent(chatRun.runId, "provisional_delta", { text: pendingInitialText });
              pendingInitialText = "";
              lastInitialFlushAt = Date.now();
            }
            yield { type: "delta", data: { text: delta, provisional: true } };
          }
        }
      }
      if (part.type === "text-end" && hasUsedTools) {
        const message = textStreams.get(part.id)?.trim() ?? "";
        textStreams.delete(part.id);
        if (message) {
          yield await completeStage(chatRun.runId, `text:${part.id}`, message);
        }
      }
      if (part.type === "tool-input-start") {
        toolInputStreams.set(part.id, { json: "", briefing: "" });
      }
      if (part.type === "tool-input-delta") {
        const inputStream = toolInputStreams.get(part.id) ?? {
          json: "",
          briefing: "",
        };
        inputStream.json += part.delta;
        const briefing = await getPartialBriefing(inputStream.json);
        if (briefing.startsWith(inputStream.briefing)) {
          const delta = briefing.slice(inputStream.briefing.length);
          if (delta) {
            inputStream.briefing = briefing;
            yield createStageUpdate(`briefing:${part.id}`, delta, "active");
          }
        }
        toolInputStreams.set(part.id, inputStream);
      }
      if (part.type === "tool-call") {
        const briefing = getPublicBriefing(part.input);
        if (briefing) {
          const inputStream = toolInputStreams.get(part.toolCallId);
          const streamedBriefing = inputStream?.briefing ?? "";
          const remaining = briefing.startsWith(streamedBriefing)
            ? briefing.slice(streamedBriefing.length)
            : briefing;
          yield await completeStage(
            chatRun.runId,
            `briefing:${part.toolCallId}`,
            briefing,
            remaining,
          );
        }
        toolInputStreams.delete(part.toolCallId);
        yield await createToolEvent(chatRun.runId, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: "started",
          message: describeToolActivity(part.toolName, "started"),
        });
      }
      if (part.type === "tool-result") {
        if (part.toolName === "search_notes" || part.toolName === "find_related") {
          hasSearched = true;
        }
        yield await createToolEvent(chatRun.runId, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: "completed",
          message: describeToolActivity(part.toolName, "completed"),
        });
      }
      if (part.type === "tool-error") {
        hasToolError = true;
        yield await createToolEvent(chatRun.runId, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: "failed",
          message: describeToolActivity(part.toolName, "failed"),
        });
      }
      if (part.type === "error") throw part.error;
    }

    if (!hasUsedTools) {
      const answer = [...textStreams.values()].join("");
      if (!answer.trim()) throw new Error("模型没有返回可保存的回答。");
      // 正文已经逐增量发送，只保存尾部事件和完成状态，不再重发全文。
      if (pendingInitialText) {
        await appendRunEvent(chatRun.runId, "provisional_delta", { text: pendingInitialText });
      }
      await completeChatRun(chatRun, answer, []);
      yield { type: "complete", data: { citations: [] } };
      return;
    }

    const citations = state.getCitations();
    if (!citations.length && hasToolError) {
      throw new Error("知识库工具执行失败，未能取得可用证据，请稍后重试。");
    }
    const sources = citations.length
      ? await readSnapshotSources(
          chatRun.snapshotId,
          citations.map((citation) => citation.chunkId),
        )
      : [];
    if (sources.length !== citations.length) {
      throw new Error("Agent 已读取的部分证据当前不可用。");
    }

    const finalResult = streamText({
      model: gateway(CHAT_MODEL),
      system: buildFinalInstruction(sources, citations, hasSearched),
      prompt: question,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      reasoning: "none",
    });

    let answer = "";
    let pendingEventText = "";
    let lastEventFlushAt = Date.now();
    for await (const textDelta of finalResult.textStream) {
      answer += textDelta;
      pendingEventText += textDelta;
      yield { type: "delta", data: { text: textDelta } };
      if (Date.now() - lastEventFlushAt >= EVENT_FLUSH_INTERVAL_MS) {
        await appendRunEvent(chatRun.runId, "final_delta", { text: pendingEventText });
        pendingEventText = "";
        lastEventFlushAt = Date.now();
      }
    }
    //模型结束后补齐文本
    if (pendingEventText) {
      await appendRunEvent(chatRun.runId, "final_delta", { text: pendingEventText });
    }
    if (!answer.trim()) throw new Error("模型没有返回可保存的回答。");
    await completeChatRun(chatRun, answer, citations);
    yield { type: "complete", data: { citations } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "知识问答执行失败。";
    await failChatRun(chatRun.runId, message);
    throw error;
  }
}

/**
 * 按序读取已持久化事件，供断线后的 SSE 补齐接口使用。
 *
 * @param runId Run 标识。
 * @param afterSequence 已在浏览器确认的最后事件序号。
 */
export async function getRunEvents(runId: string, afterSequence: number) {
  return getDatabase()
    .select({
      sequence: runEvents.sequence,
      eventType: runEvents.eventType,
      payload: runEvents.payload,
      createdAt: runEvents.createdAt,
    })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.sequence, afterSequence)))
    .orderBy(runEvents.sequence);
}

/**
 * 软删除会话，不会删除其对应的知识库文件。
 *
 * @param conversationId 会话标识。
 */
export async function deleteConversation(conversationId: string) {
  const result = await getDatabase()
    .update(conversations)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.workspaceId, LOCAL_WORKSPACE_ID),
        isNull(conversations.deletedAt),
      ),
    )
    .returning({ id: conversations.id });

  return result.length > 0;
}

/** 以首条问题生成 D3 会话标题，避免额外模型调用。 */
function makeConversationTitle(question: string) {
  return question.replace(/\s+/g, " ").trim().slice(0, 60);
}

/** 创建公开阶段增量；增量只发往当前 SSE，完整文本在阶段结束时统一持久化。 */
function createStageUpdate(
  stageId: string,
  delta: string,
  status: ChatStageUpdate["status"],
): ChatStreamEvent {
  return { type: "stage", data: { stageId, delta, status } };
}

/** 持久化完整公开阶段，并发布可能尚未发出的尾部文本和完成状态。 */
async function completeStage(
  runId: string,
  stageId: string,
  message: string,
  delta = "",
): Promise<ChatStreamEvent> {
  await appendRunEvent(runId, "stage_message", { stageId, message });
  return createStageUpdate(stageId, delta, "complete");
}

/** 从尚未闭合的工具 JSON 中读取已生成的 briefing 文本。 */
async function getPartialBriefing(json: string) {
  const { value } = await parsePartialJson(json);
  return getPublicBriefing(value, false) ?? "";
}

/**
 * 构造最终回答说明；普通交流允许无引用，知识库事实仍必须有已读取证据。
 * @param sources 当前 Run 已读取且重新授权的来源。
 * @param citations 与来源对应的引用编号。
 * @param hasSearched 是否有搜索工具成功返回，避免虚构检索经历。
 */
function buildFinalInstruction(
  sources: Awaited<ReturnType<typeof readSnapshotSources>>,
  citations: ChatCitation[],
  hasSearched: boolean,
) {
  if (!sources.length) {
    return [
      "你是 VaultAgent，帮助用户了解和使用自己的知识库。请直接输出面向用户的最终回答。",
      "本次没有已读取的知识库证据。问候、致谢和能力介绍正常简短回复，不需要引用，也不要向普通问候解释证据不足。",
      "若问题需要知识库内容，明确说明目前没有取得支持答案的资料，不能用一般知识冒充用户文档内容，不编造文件、引用或执行结果。",
      hasSearched
        ? "本次已执行搜索，但未取得已读取的支持证据；这不代表知识库中绝对不存在相关内容。"
        : "本次没有成功执行知识库搜索，不要声称已经查找或没有找到相关资料。",
      "不输出私密推理、内部标识或错误堆栈。",
    ].join("\n\n");
  }
  const citationIds = new Map(
    citations.map((citation) => [citation.chunkId, citation.id]),
  );
  const sourceText = sources
    .map(
      (source) =>
        `【${citationIds.get(source.chunkId)}】${source.displayName}\n${source.content}`,
    )
    .join("\n\n");

  return [
    "你是 VaultAgent。只根据 Agent 已读取的以下知识库证据回答，资料不足时明确说明。",
    "不要编造资料中不存在的内容，也不要输出私密思维过程。",
    "引用关键结论时使用【编号】；编号必须来自以下已读取证据。",
    "已读取证据：",
    sourceText,
  ].join("\n\n");
}

/**
 * 按单 Run 的单调序号写入事件。
 *
 * 单轮流式生成与检索 Trace 都会写入事件，因此在当前执行器中串行化 sequence 分配。
 * D10 的跨进程恢复会补充持久执行租约和数据库级并发处理。
 */
async function appendRunEvent(runId: string, eventType: string, payload: object) {
  const previousWrite = pendingEventWrites.get(runId) ?? Promise.resolve();
  const write = previousWrite
    .catch(() => undefined)
    .then(() => writeRunEvent(runId, eventType, payload));
  pendingEventWrites.set(runId, write);
  try {
    await write;
  } finally {
    if (pendingEventWrites.get(runId) === write) pendingEventWrites.delete(runId);
  }
}

/** 在已串行化的上下文中查询并分配下一个事件序号。 */
async function writeRunEvent(runId: string, eventType: string, payload: object) {
  const db = getDatabase();
  const [lastEvent] = await db
    .select({ sequence: runEvents.sequence })
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(desc(runEvents.sequence))
    .limit(1);

  await db.insert(runEvents).values({
    id: randomUUID(),
    runId,
    sequence: (lastEvent?.sequence ?? 0) + 1,
    eventType,
    payload,
  });
}

/** 创建、持久化并发布一条脱敏工具活动。 */
async function createToolEvent(
  runId: string,
  activity: ChatToolActivity,
): Promise<ChatStreamEvent> {
  await appendRunEvent(
    runId,
    activity.status === "started" ? "tool_started" : "tool_finished",
    activity,
  );
  return { type: "tool", data: activity };
}

/** 只读取工具 Schema 显式要求的公开 briefing，不透出其他模型参数。 */
function getPublicBriefing(input: unknown, trim = true) {
  if (!input || typeof input !== "object") return null;
  const briefing = (input as { briefing?: unknown }).briefing;
  if (typeof briefing !== "string" || !briefing.trim()) return null;
  const limited = briefing.slice(0, 200);
  return trim ? limited.trim() : limited;
}

/** 将工具名映射为公开短说明，避免透出参数、正文或内部错误。 */
function describeToolActivity(
  toolName: string,
  status: ChatToolActivity["status"],
) {
  const labels: Record<string, string> = {
    search_notes: "搜索知识库",
    read_sources: "读取来源片段",
    find_related: "查找关联资料",
    finish_research: "完成证据收集",
  };
  const label = labels[toolName] ?? "执行受限工具";
  if (status === "started") return `${label}…`;
  if (status === "completed") return `${label}完成`;
  return `${label}未完成`;
}

/** 同一事务提交最终回答、Run 终态与完成事件，避免刷新后出现双重完成。 */
async function completeChatRun(chatRun: ChatRun, answer: string, citations: ChatCitation[]) {
  const db = getDatabase();
  await db.transaction(async (transaction) => {
    const [lastEvent] = await transaction
      .select({ sequence: runEvents.sequence })
      .from(runEvents)
      .where(eq(runEvents.runId, chatRun.runId))
      .orderBy(desc(runEvents.sequence))
      .limit(1);
  //保存助手消息
    await transaction.insert(messages).values({
      id: randomUUID(),
      conversationId: chatRun.conversationId,
      runId: chatRun.runId,
      role: "assistant",
      content: answer,
      status: "completed",
      citations,
    });
  //更新run得状态
    await transaction
      .update(runs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(runs.id, chatRun.runId));
  //写入完成事件
    await transaction.insert(runEvents).values({
      id: randomUUID(),
      runId: chatRun.runId,
      sequence: (lastEvent?.sequence ?? 0) + 1,
      eventType: "run_completed",
      payload: { citations },
    });
  });
}

/** 保存失败终态与安全错误消息，保留此前已验证的事件。 */
async function failChatRun(runId: string, message: string) {
  const db = getDatabase();
  await db.transaction(async (transaction) => {
    const [lastEvent] = await transaction
      .select({ sequence: runEvents.sequence })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(desc(runEvents.sequence))
      .limit(1);

    await transaction
      .update(runs)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(runs.id, runId));
    await transaction.insert(runEvents).values({
      id: randomUUID(),
      runId,
      sequence: (lastEvent?.sequence ?? 0) + 1,
      eventType: "run_failed",
      payload: { message: message.slice(0, 500) },
    });
  });
}
