/**
 * 修改时间：2026-09-15
 * 文件说明：AI SDK Agent 流到公开 Run 过程事件的转换。
 *
 * 只发布显式阶段文本、briefing 和脱敏工具状态；reasoning、工具参数及来源正文不会
 * 进入浏览器事件。
 *
 * edit by：Sliye
 */

import { parsePartialJson, type TextStreamPart } from "ai";
import type { createVaultTools } from "@/lib/agent/tools";
import { appendRunEvent } from "@/lib/chat/run-events";
import type {
  ChatStageUpdate,
  ChatStreamEvent,
  ChatToolActivity,
} from "@/lib/chat/run-types";

/** 阶段公开文本的最大字符数。 */
const MAX_STAGE_CHARACTERS = 800;

/** 当前工具注册表对应的 AI SDK 完整流事件。 */
type VaultAgentStreamPart = TextStreamPart<
  ReturnType<typeof createVaultTools>
>;

/** 把 AI SDK Agent 完整流转换为脱敏阶段增量和工具活动。 */
export async function* streamAgentEvents(
  runId: string,
  stream: AsyncIterable<VaultAgentStreamPart>,
): AsyncGenerator<ChatStreamEvent> {
  const toolInputStreams = new Map<
    string,
    { json: string; briefing: string }
  >();
  const textStreams = new Map<string, string>();

  for await (const part of stream) {
    if (part.type === "text-start") textStreams.set(part.id, "");
    if (part.type === "text-delta") {
      const current = textStreams.get(part.id) ?? "";
      const delta = part.text.slice(
        0,
        Math.max(0, MAX_STAGE_CHARACTERS - current.length),
      );
      if (delta) {
        textStreams.set(part.id, current + delta);
        yield createStageUpdate(`text:${part.id}`, delta, "active");
      }
    }
    if (part.type === "text-end") {
      const message = textStreams.get(part.id)?.trim() ?? "";
      textStreams.delete(part.id);
      if (message)
        yield await completeStage(runId, `text:${part.id}`, message);
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
      const { toolCallId, toolName } = part;
      const briefing = getPublicBriefing(part.input);
      if (briefing) {
        const streamedBriefing = toolInputStreams.get(toolCallId)?.briefing ?? "";
        const remaining = briefing.startsWith(streamedBriefing)
          ? briefing.slice(streamedBriefing.length)
          : briefing;
        yield await completeStage(
          runId,
          `briefing:${toolCallId}`,
          briefing,
          remaining,
        );
      }
      toolInputStreams.delete(toolCallId);
      yield await createToolEvent(runId, {
        toolCallId,
        toolName,
        status: "started",
        message: describeToolActivity(toolName, "started"),
      });
    }
    if (part.type === "tool-result" || part.type === "tool-error") {
      const { toolCallId, toolName } = part;
      const status = part.type === "tool-result" ? "completed" : "failed";
      yield await createToolEvent(runId, {
        toolCallId,
        toolName,
        status,
        message: describeToolActivity(toolName, status),
      });
    }
    if (part.type === "error") throw part.error;
  }
}

/** 创建并持久化一条脱敏工具活动。 */
export async function createToolEvent(
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

/** 将工具名和状态转换为不含参数或正文的公开说明。 */
export function describeToolActivity(
  toolName: string,
  status: ChatToolActivity["status"],
) {
  const labels: Record<string, string> = {
    initial_retrieval: "检索知识库",
    search_notes: "补充搜索知识库",
    read_sources: "读取来源片段",
    expand_context: "扩展同文上下文",
    finish_research: "完成证据收集",
  };
  const label = labels[toolName] ?? "执行受限工具";
  if (status === "started") return `${label}…`;
  if (status === "completed") return `${label}完成`;
  return `${label}未完成`;
}

/** 创建一段公开阶段文本增量。 */
function createStageUpdate(
  stageId: string,
  delta: string,
  status: ChatStageUpdate["status"],
): ChatStreamEvent {
  return { type: "stage", data: { stageId, delta, status } };
}

/** 持久化完整阶段，并发布尚未发出的尾部文本和完成状态。 */
async function completeStage(
  runId: string,
  stageId: string,
  message: string,
  delta = "",
): Promise<ChatStreamEvent> {
  await appendRunEvent(runId, "stage_message", { stageId, message });
  return createStageUpdate(stageId, delta, "complete");
}

/** 从尚未闭合的工具 JSON 中读取已经生成的 briefing。 */
async function getPartialBriefing(json: string) {
  const { value } = await parsePartialJson(json);
  return getPublicBriefing(value, false) ?? "";
}

/** 只读取工具 Schema 显式声明的公开 briefing。 */
function getPublicBriefing(input: unknown, trim = true) {
  if (!input || typeof input !== "object") return null;
  const briefing = (input as { briefing?: unknown }).briefing;
  if (typeof briefing !== "string" || !briefing.trim()) return null;
  const limited = briefing.slice(0, 200);
  return trim ? limited.trim() : limited;
}

