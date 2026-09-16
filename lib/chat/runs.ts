/**
 * 修改时间：2026-09-16
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
import { selectAnswerCitations } from "@/lib/chat/citations";
import { buildFinalInstruction } from "@/lib/chat/final-answer";
import { createPublicAnswerDraft } from "@/lib/chat/public-draft";
import { getDatabase } from "@/lib/db/client";
import { conversations, messages, runEvents, runs } from "@/lib/db/schema";
import { ensureLocalPrincipal, LOCAL_WORKSPACE_ID } from "@/lib/ingestion/imports";
import { getLatestPublishedSnapshot } from "@/lib/retrieval/search";
import { readSnapshotSources } from "@/lib/sources/reader";
import { readFileInventory } from "@/lib/sources/file-inventory";
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
  snapshotId: string | null; //本次问答固定的快照；空库允许普通交流
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
  await ensureLocalPrincipal();
  const snapshot = await getLatestPublishedSnapshot(LOCAL_WORKSPACE_ID);

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
      snapshotId: snapshot?.id ?? null,
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
      payload: { message: "正在处理问题" },
    });
  });

  return { conversationId: resolvedConversationId, runId, snapshotId: snapshot?.id ?? null };
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
    /** 公开文本同时作为待核验草稿；使用工具后的文本展示在执行过程区。 */
    const publicDraft = createPublicAnswerDraft();
    /** 首段实时展示；首次调用工具后清空临时正文，由工具 briefing 接续进度。 */
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
        // 空 stages 只清空工具调用前的临时正文；后续公开文本单独发布为阶段事件。
        await appendRunEvent(chatRun.runId, "answer_to_stage", { stages: [] });
        yield { type: "answer-stage", data: { stages: [] } };
        textStreams.clear();
      }
      if (part.type === "text-start") {
        textStreams.set(part.id, "");
      }
      if (part.type === "text-delta") {
        const stageId = `text:${part.id}`;
        publicDraft.append(stageId, "public-text", part.text);
        const current = textStreams.get(part.id) ?? "";
        const delta = part.text;
        if (delta) {
          textStreams.set(part.id, current + delta);
          // 中间回答只进入执行过程，避免与最终正文拼接或提前折叠过程面板。
          if (hasUsedTools) {
            yield createStageUpdate(stageId, delta, "active");
            continue;
          }
          pendingInitialText += delta;
          if (Date.now() - lastInitialFlushAt >= EVENT_FLUSH_INTERVAL_MS) {
            await appendRunEvent(chatRun.runId, "provisional_delta", { text: pendingInitialText });
            pendingInitialText = "";
            lastInitialFlushAt = Date.now();
          }
          yield { type: "delta", data: { text: delta, provisional: true } };
        }
      }
      if (part.type === "text-end" && hasUsedTools) {
        const message = textStreams.get(part.id);
        if (message?.trim()) {
          yield await completeStage(chatRun.runId, `text:${part.id}`, message);
        }
        textStreams.delete(part.id);
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
        if (part.toolName === "finish_research" && briefing) {
          publicDraft.append(`finish:${part.toolCallId}`, "finish-summary", briefing);
        }
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
        if ((part.toolName === "search_notes" || part.toolName === "find_related") &&
            part.output !== null && typeof part.output === "object" &&
            "status" in part.output && part.output.status === "searched") {
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
      selectAnswerCitations(answer, []);
      // 正文已经逐增量发送，只保存尾部事件和完成状态，不再重发全文。
      if (pendingInitialText) {
        await appendRunEvent(chatRun.runId, "provisional_delta", { text: pendingInitialText });
      }
      await completeChatRun(chatRun, answer, []);
      yield { type: "complete", data: { citations: [] } };
      return;
    }

    const citations = state.getCitations();
    /** 文件元数据是独立证据，不要求先读取正文；按成功查询过的页重新授权。 */
    const fileListOffsets = state.getFileListOffsets();
    const fileInventory = chatRun.snapshotId && fileListOffsets.length
      ? await readFileInventory(chatRun.snapshotId, fileListOffsets)
      : null;
    if (!citations.length && !fileInventory && hasToolError) {
      throw new Error("知识库工具执行失败，未能取得可用证据，请稍后重试。");
    }
    const sources = citations.length && chatRun.snapshotId
      ? await readSnapshotSources(
          chatRun.snapshotId,
          citations.map((citation) => citation.chunkId),
        )
      : [];
    if (sources.length !== citations.length) {
      throw new Error("Agent 已读取的部分证据当前不可用。");
    }
    if (fileInventory) {
      await appendRunEvent(chatRun.runId, "file_inventory", fileInventory);
    }

    const finalResult = streamText({
      model: gateway(CHAT_MODEL),
      system: buildFinalInstruction({
        sources, citations, hasSearched, hasToolError,
        publicDraft: publicDraft.getDraft(),
        fileInventory,
      }),
      prompt: question,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      reasoning: "none",
    });

    let answer = "";
    let pendingEventText = "";
    let lastEventFlushAt = Date.now();
    // fullStream 显式处理部分输出后的模型错误，不能将截断回答保存为成功。
    // 官方：https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
    for await (const part of finalResult.fullStream) {
      if (part.type === "error") throw part.error;
      if (part.type !== "text-delta") continue;
      const textDelta = part.text;
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
    // 生成期间可能删除文件；清单发生变化时不能把已过期内容保存为成功回答。
    if (fileInventory && chatRun.snapshotId) {
      const available = await readFileInventory(chatRun.snapshotId, fileListOffsets);
      if (JSON.stringify(available) !== JSON.stringify(fileInventory)) {
        throw new Error("回答期间知识库文件清单已变化，请重新提问。");
      }
    }
    const answerCitations = selectAnswerCitations(answer, citations);
    // 输出期间资料也可能被删除，发布前再次校验实际引用的来源。
    if (answerCitations.length && chatRun.snapshotId) {
      const available = await readSnapshotSources(chatRun.snapshotId, answerCitations.map((citation) => citation.chunkId));
      if (available.length !== answerCitations.length) throw new Error("回答引用的部分来源已不可用，请重新提问。");
    }
    await completeChatRun(chatRun, answer, answerCitations);
    yield { type: "complete", data: { citations: answerCitations } };
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
    list_files: "查询文件清单",
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
