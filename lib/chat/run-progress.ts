/** 修改时间：2026-09-17 | 文件说明：模型流向公开进度事件的转换，不负责数据库或传输 | edit by：Sliye */
import { parsePartialJson } from "ai";
import type { ChatStageUpdate, ChatStreamEvent, ChatToolActivity } from "@/lib/chat/types";

/** 创建公开阶段增量，由执行边界统一持久化后供订阅读取。 */
export function createStageUpdate(
  stageId: string,
  delta: string,
  status: ChatStageUpdate["status"],
): ChatStreamEvent {
  return { type: "stage", data: { stageId, delta, status } };
}

/** 以完整文本替换阶段并标记完成，实时读取与历史回放使用同一事件。 */
export function completeStage(
  stageId: string,
  message: string,
): ChatStreamEvent {
  return { type: "stage", data: { stageId, delta: message, status: "complete", replace: true } };
}

/** 从尚未闭合的工具 JSON 中读取已生成的 briefing 文本。 */
export async function getPartialBriefing(json: string) {
  const { value } = await parsePartialJson(json);
  return getPublicBriefing(value, false) ?? "";
}

/** 创建一条脱敏工具活动。 */
export function createToolEvent(
  activity: ChatToolActivity,
): ChatStreamEvent {
  return { type: "tool", data: activity };
}

/** 只读取工具 Schema 显式要求的公开 briefing，不透出其他模型参数。 */
export function getPublicBriefing(input: unknown, trim = true) {
  if (!input || typeof input !== "object") return null;
  const briefing = (input as { briefing?: unknown }).briefing;
  if (typeof briefing !== "string" || !briefing.trim()) return null;
  const limited = briefing.slice(0, 200);
  return trim ? limited.trim() : limited;
}

/** 将工具名映射为公开短说明，避免透出参数、正文或内部错误。 */
export function describeToolActivity(
  toolName: string,
  status: ChatToolActivity["status"],
) {
  const labels: Record<string, string> = {
    list_files: "查询文件清单",
    search_notes: "搜索知识库",
    search_web: "联网搜索",
    read_sources: "读取来源片段",
    find_related: "查找关联资料",
    finish_research: "完成证据收集",
  };
  const label = labels[toolName] ?? "执行受限工具";
  if (status === "started") return `${label}…`;
  if (status === "completed") return `${label}完成`;
  return `${label}未完成`;
}
