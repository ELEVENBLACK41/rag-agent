/** 修改时间：2026-09-16 | 文件说明：多步问答执行、证据交接与最终答案流式生成
 * 
 *  服务端执行编排层，同时也是服务端事件流的生产者
 * 
 *  | edit by：Sliye */
import { gateway, Output, parsePartialJson, streamText } from "ai";
import { createVaultRunAgent } from "@/lib/agent/run-agent";
import { createVaultRunState } from "@/lib/agent/run-state";
import { selectAnswerCitations } from "@/lib/chat/citations";
import {
  buildFinalInstruction,
  finalAnswerSchema,
} from "@/lib/chat/final-answer";
import { createPublicAnswerDraft } from "@/lib/chat/public-draft";
import { loadConversationContext } from "@/lib/chat/conversation-context";
import {
  appendRunEvent,
  completeChatRun,
  failChatRun,
} from "@/lib/chat/run-store";
import { readSnapshotSources } from "@/lib/sources/reader";
import { readFileInventory } from "@/lib/sources/file-inventory";
import type {
  ChatRun,
  ChatStageUpdate,
  ChatStreamEvent,
  ChatToolActivity,
} from "@/lib/chat/types";
/** Agent 与最终回答共同使用的已验证主模型。 */
const CHAT_MODEL = "alibaba/qwen3.7-flash";
/** 最终回答输出上限，避免上下文与费用无界增长。 */
const MAX_OUTPUT_TOKENS = 1_200;
/** 文本增量写入事件库的最短时间窗口，毫秒。 */
const EVENT_FLUSH_INTERVAL_MS = 300;

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
      onRetrievalTrace: (trace) =>
        appendRunEvent(chatRun.runId, "retrieval_trace", trace),
    });
    /** 两个模型阶段共享相同的最近完整对话，本轮问题只追加一次。 */
    const context = await loadConversationContext(chatRun, question);
    const agent = createVaultRunAgent(state, context.truncated);
    /** context.messages大概是
     * { role: "user", content: "上一个问题" },
     * { role: "assistant", content: "上一个回答" },
     * { role: "user", content: "当前问题" },
     */
    const agentResult = await agent.stream({ messages: context.messages });
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

    // stream 同时提供模型文本和工具参数增量；只发布公开文本，不读取 reasoning。
    for await (const part of agentResult.stream) {
      if (
        !hasUsedTools &&
        (part.type === "tool-input-start" || part.type === "tool-call")
      ) {
        hasUsedTools = true;
        if (pendingInitialText) {
          await appendRunEvent(chatRun.runId, "provisional_delta", {
            text: pendingInitialText,
            format: "plain",
          });
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
            await appendRunEvent(chatRun.runId, "provisional_delta", {
              text: pendingInitialText,
              format: "plain",
            });
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
          publicDraft.append(
            `finish:${part.toolCallId}`,
            "finish-summary",
            briefing,
          );
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
        if (
          (part.toolName === "search_notes" ||
            part.toolName === "find_related") &&
          part.output !== null &&
          typeof part.output === "object" &&
          "status" in part.output &&
          part.output.status === "searched"
        ) {
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
        await appendRunEvent(chatRun.runId, "provisional_delta", {
          text: pendingInitialText,
          format: "plain",
        });
      }
      await completeChatRun(chatRun, answer, []);
      yield { type: "complete", data: { citations: [] } };
      return;
    }

    const citations = state.getCitations();
    /** 文件元数据是独立证据，不要求先读取正文；按成功查询过的页重新授权。 */
    const fileListOffsets = state.getFileListOffsets();
    const fileInventory =
      chatRun.snapshotId && fileListOffsets.length
        ? await readFileInventory(chatRun.snapshotId, fileListOffsets)
        : null;
    if (!citations.length && !fileInventory && hasToolError) {
      throw new Error("知识库工具执行失败，未能取得可用证据，请稍后重试。");
    }
    const sources =
      citations.length && chatRun.snapshotId
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

    /** partialOutputStream 只提供对象增量；模型错误另行捕获，不能将半段答案保存为成功。 */
    let finalStreamError: unknown;
    const finalResult = streamText({
      model: gateway(CHAT_MODEL),
      system: buildFinalInstruction({
        sources,
        citations,
        hasSearched,
        hasToolError,
        publicDraft: publicDraft.getDraft(),
        fileInventory,
        historyTruncated: context.truncated,
      }),
      messages: context.messages,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      reasoning: "none",
      // 官方：https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data；正文与来源采用独立字段。
      output: Output.object({ schema: finalAnswerSchema }),
      onError: ({ error }) => {
        finalStreamError = error;
      },
    });

    let answer = "";
    let pendingEventText = "";
    let lastEventFlushAt = Date.now();
    // SDK 负责流式 JSON 解析；正文增量事件只传 answer，不传 JSON 或 citationIds。
    for await (const partial of finalResult.partialOutputStream) {
      if (typeof partial.answer !== "string") continue;
      if (!partial.answer.startsWith(answer))
        throw new Error("回答流发生不一致，请重新提问。");
      const textDelta = partial.answer.slice(answer.length);
      if (!textDelta) continue;
      answer = partial.answer;
      pendingEventText += textDelta;
      yield { type: "delta", data: { text: textDelta } };
      if (Date.now() - lastEventFlushAt >= EVENT_FLUSH_INTERVAL_MS) {
        await appendRunEvent(chatRun.runId, "final_delta", {
          text: pendingEventText,
          format: "plain",
        });
        pendingEventText = "";
        lastEventFlushAt = Date.now();
      }
    }
    if (finalStreamError !== undefined) throw finalStreamError;
    const output = await finalResult.output;
    if ((await finalResult.finishReason) === "length")
      throw new Error("回答生成达到长度上限，请缩小问题范围后重试。");
    // 完整对象通过 Schema 校验后补齐 SDK 未推送的尾部；不重新生成或拼接另一份答案。
    if (!output.answer.startsWith(answer))
      throw new Error("回答流发生不一致，请重新提问。");
    const remaining = output.answer.slice(answer.length);
    if (remaining) {
      answer = output.answer;
      pendingEventText += remaining;
      yield { type: "delta", data: { text: remaining } };
    }
    if (pendingEventText) {
      await appendRunEvent(chatRun.runId, "final_delta", {
        text: pendingEventText,
        format: "plain",
      });
    }
    if (!answer.trim()) throw new Error("模型没有返回可保存的回答。");
    // 生成期间可能删除文件；清单发生变化时不能把已过期内容保存为成功回答。
    if (fileInventory && chatRun.snapshotId) {
      const available = await readFileInventory(
        chatRun.snapshotId,
        fileListOffsets,
      );
      if (JSON.stringify(available) !== JSON.stringify(fileInventory)) {
        throw new Error("回答期间知识库文件清单已变化，请重新提问。");
      }
    }
    const answerCitations = selectAnswerCitations(
      output.citationIds,
      citations,
    );
    // 输出期间资料也可能被删除，发布前再次校验实际引用的来源。
    if (answerCitations.length && chatRun.snapshotId) {
      const available = await readSnapshotSources(
        chatRun.snapshotId,
        answerCitations.map((citation) => citation.chunkId),
      );
      if (available.length !== answerCitations.length)
        throw new Error("回答引用的部分来源已不可用，请重新提问。");
    }
    await completeChatRun(chatRun, answer, answerCitations);
    yield { type: "complete", data: { citations: answerCitations } };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "知识问答执行失败。";
    await failChatRun(chatRun.runId, message);
    throw error;
  }
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
