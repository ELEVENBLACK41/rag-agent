/**
 * 修改时间：2026-09-15
 * 文件说明：VaultAgent 最终回答生成、证据提示与增量持久化。
 *
 * 最终回答与 Agent 阶段流分离；知识库路径只能使用服务器实际读取的证据。
 *
 * edit by：Sliye
 */

import { gateway, streamText } from "ai";
import { CHAT_MODEL } from "@/lib/agent/model-config";
import { appendRunEvent } from "@/lib/chat/run-events";
import { completeChatRun } from "@/lib/chat/run-store";
import type {
  ChatCitation,
  ChatRun,
  ChatStreamEvent,
} from "@/lib/chat/run-types";
import { readSnapshotSources } from "@/lib/sources/reader";

/** 最终回答输出上限，避免上下文与费用无界增长。 */
const MAX_OUTPUT_TOKENS = 1_200;
/** 文本增量写入事件库的最短时间窗口。 */
const EVENT_FLUSH_INTERVAL_MS = 300;

/** 使用独立生成器流式输出最终回答，并按时间窗口持久化文本。 */
export async function* streamFinalAnswer(
  chatRun: ChatRun,
  question: string,
  citations: ChatCitation[],
  system: string,
): AsyncGenerator<ChatStreamEvent> {
  const result = streamText({
    model: gateway(CHAT_MODEL),
    system,
    prompt: question,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    reasoning: "none",
  });

  let answer = "";
  let pendingEventText = "";
  let pendingModelText = "";
  let lastEventFlushAt = Date.now();
  for await (const textDelta of result.textStream) {
    pendingModelText += textDelta;
    const filtered = filterInlineCitationMarkers(pendingModelText);
    pendingModelText = filtered.remainder;
    if (!filtered.text) continue;

    answer += filtered.text;
    pendingEventText += filtered.text;
    yield { type: "delta", data: { text: filtered.text } };
    if (Date.now() - lastEventFlushAt >= EVENT_FLUSH_INTERVAL_MS) {
      await appendRunEvent(chatRun.runId, "final_delta", {
        text: pendingEventText,
      });
      pendingEventText = "";
      lastEventFlushAt = Date.now();
    }
  }
  const trailingText = filterInlineCitationMarkers(pendingModelText, true).text;
  if (trailingText) {
    answer += trailingText;
    pendingEventText += trailingText;
    yield { type: "delta", data: { text: trailingText } };
  }
  if (pendingEventText)
    await appendRunEvent(chatRun.runId, "final_delta", {
      text: pendingEventText,
    });
  if (!answer.trim()) throw new Error("模型没有返回可保存的回答。");

  await completeChatRun(chatRun, answer, citations);
  yield { type: "complete", data: { citations } };
}

/** 检索无候选时确定性结束，禁止模型在没有证据时猜测。 */
export async function* completeWithoutEvidence(
  chatRun: ChatRun,
): AsyncGenerator<ChatStreamEvent> {
  const answer = "我没有在当前知识库中找到足够证据来回答这个问题。";
  await appendRunEvent(chatRun.runId, "final_delta", { text: answer });
  yield { type: "delta", data: { text: answer } };
  await completeChatRun(chatRun, answer, []);
  yield { type: "complete", data: { citations: [] } };
}

/** direct 路径不声明已经访问知识库。 */
export function buildDirectInstruction() {
  return [
    "你是 VaultAgent。直接回答当前请求，不调用知识库或声称已经读取用户资料。",
    "回答应简洁、准确；不要输出私密思维过程。",
  ].join("\n");
}

/** 构造只允许根据已读取证据回答的最终生成说明。 */
export function buildFinalInstruction(
  sources: Awaited<ReturnType<typeof readSnapshotSources>>,
  citations: ChatCitation[],
) {
  const citationIds = new Map(
    citations.map((citation) => [citation.chunkId, citation.id]),
  );
  const sourceText = sources
    .map(
      (source) =>
        `来源 ${citationIds.get(source.chunkId)}：${source.displayName}\n${source.content}`,
    )
    .join("\n\n");

  return [
    "你是 VaultAgent。只根据系统已读取的以下知识库证据回答，资料不足时明确说明。",
    "不要编造资料中不存在的内容，也不要输出私密思维过程。",
    "来源列表由系统在回答下方独立展示；正文不要输出【1】、【2】等引用编号或其他内联来源标记。",
    "已读取证据：",
    sourceText,
  ].join("\n\n");
}

/**
 * 从模型增量中移除纯数字引用标记，同时保留普通中文方头括号内容。
 *
 * @param text 尚未发布到客户端的模型文本。
 * @param flush 是否正在处理流末尾；流中未闭合标记需要留到下一增量判断。
 */
export function filterInlineCitationMarkers(text: string, flush = false) {
  let filteredText = "";
  let cursor = 0;

  while (cursor < text.length) {
    const markerStart = text.indexOf("【", cursor);
    if (markerStart < 0) {
      filteredText += text.slice(cursor);
      return { text: filteredText, remainder: "" };
    }

    filteredText += text.slice(cursor, markerStart);
    const markerEnd = text.indexOf("】", markerStart + 1);
    if (markerEnd < 0) {
      const unfinishedMarker = text.slice(markerStart + 1);
      if (!/^[\s0-9０-９,，、-]*$/.test(unfinishedMarker)) {
        return { text: filteredText + text.slice(markerStart), remainder: "" };
      }
      return flush
        ? { text: filteredText + text.slice(markerStart), remainder: "" }
        : { text: filteredText, remainder: text.slice(markerStart) };
    }

    const markerContent = text.slice(markerStart + 1, markerEnd).trim();
    if (!/^[0-9０-９]+(?:\s*[,，、-]\s*[0-9０-９]+)*$/.test(markerContent)) {
      filteredText += text.slice(markerStart, markerEnd + 1);
    }
    cursor = markerEnd + 1;
  }

  return { text: filteredText, remainder: "" };
}
