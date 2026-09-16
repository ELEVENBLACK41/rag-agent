/** 修改时间：2026-09-16 | 文件说明：实时聊天与历史回放共用的纯消息状态转换 | edit by：Sliye */
import type {
  ChatMessage,
  ChatStageUpdate,
  ChatStreamEvent,
  ChatToolActivity,
  RunProcessState,
  StoredRunEvent,
} from "@/lib/chat/types";
import type { SourceCitation } from "@/lib/sources/types";

/** @param id 助手消息 ID。 @param startedAt 本轮真实开始时间，毫秒。 */
export function createAssistantMessage(
  id: string,
  startedAt: number,
): ChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    process: { status: "running", startedAt, open: true, events: [] },
  };
}

/** 合并阶段增量，回放的完整阶段通过 replace 替换，避免重复文本。 */
function updateStage(
  process: RunProcessState,
  stage: ChatStageUpdate,
): RunProcessState {
  const exists = process.events.some(
    (event) => event.id === stage.stageId && event.kind === "stage",
  );
  const events = process.events.map((event) => {
    if (event.kind !== "stage") return event;
    if (event.id === stage.stageId)
      return {
        ...event,
        message: stage.replace ? stage.delta : event.message + stage.delta,
        status: stage.status,
      };
    return !exists && event.status === "active"
      ? { ...event, status: "complete" as const }
      : event;
  });
  if (!exists)
    events.push({
      id: stage.stageId,
      kind: "stage",
      message: stage.delta,
      status: stage.status,
    });
  return { ...process, events };
}

/** @param message 当前助手消息。 @param event 已解析的公开事件。 @param now 事件发生时间，毫秒。 */
export function applyChatEvent(
  message: ChatMessage,
  event: ChatStreamEvent,
  now: number,
): ChatMessage {
  const process = message.process;
  if (event.type === "run") return { ...message, runId: event.data.runId };
  if (!process) return message;
  switch (event.type) {
    case "delta":
      return {
        ...message,
        content: message.content + event.data.text,
        process:
          !message.content && !event.data.provisional
            ? { ...process, open: false }
            : process,
      };
    case "stage":
      return { ...message, process: updateStage(process, event.data) };
    case "tool": {
      const activity = event.data;
      const item = {
        id: activity.toolCallId,
        kind: "tool" as const,
        message: activity.message,
        status: activity.status,
      };
      const exists = process.events.some(
        (entry) => entry.id === item.id && entry.kind === "tool",
      );
      return {
        ...message,
        process: {
          ...process,
          events: exists
            ? process.events.map((entry) =>
                entry.id === item.id && entry.kind === "tool" ? item : entry,
              )
            : [...process.events, item],
        },
      };
    }
    case "answer-stage": {
      let next = { ...process, open: true };
      for (const stage of event.data.stages)
        next = updateStage(next, { ...stage, replace: true });
      return {
        ...message,
        content: "",
        legacyCitationMarkers: false,
        process: next,
      };
    }
    case "complete":
      return {
        ...message,
        citations: event.data.citations,
        process: {
          ...process,
          status: "completed",
          completedAt: now,
          open: false,
          events: process.events.map((entry) =>
            entry.kind === "stage" ? { ...entry, status: "complete" } : entry,
          ),
        },
      };
    case "error":
      return {
        ...message,
        error: event.data.message,
        process: { ...process, status: "failed", completedAt: now, open: true },
      };
  }
}

/** 将已持久化事件恢复成公开消息，检索 Trace 等内部事件不进入界面。 */
export function replayMessageEvent(
  message: ChatMessage,
  record: StoredRunEvent,
): ChatMessage {
  const payload = record.payload;
  const now = record.createdAt.getTime();
  let event: ChatStreamEvent;
  switch (record.eventType) {
    case "final_delta":
    case "provisional_delta":
      return {
        ...applyChatEvent(
          message,
          {
            type: "delta",
            data: {
              text: String(payload.text ?? ""),
              provisional: record.eventType === "provisional_delta",
            },
          },
          now,
        ),
        legacyCitationMarkers: payload.format !== "plain",
      };
    case "answer_to_stage":
      event = {
        type: "answer-stage",
        data: { stages: payload.stages as ChatStageUpdate[] },
      };
      break;
    case "stage_message":
      event = {
        type: "stage",
        data: {
          stageId: String(payload.stageId ?? `stage:${record.sequence}`),
          delta: String(payload.message ?? ""),
          status: "complete",
          replace: true,
        },
      };
      break;
    case "tool_started":
    case "tool_finished":
      event = { type: "tool", data: payload as ChatToolActivity };
      break;
    case "run_completed":
      event = {
        type: "complete",
        data: { citations: payload.citations as SourceCitation[] },
      };
      break;
    case "run_failed":
      event = {
        type: "error",
        data: { message: String(payload.message ?? "执行失败。") },
      };
      break;
    default:
      return message;
  }
  return applyChatEvent(message, event, now);
}
