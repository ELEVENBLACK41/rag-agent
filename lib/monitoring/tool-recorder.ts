/** 修改时间：2026-09-17 | 文件说明：按真实工具调用 ID 记录结果状态和数量，不保存参数或正文 | edit by：Sliye */
import { recordObservation } from "@/lib/monitoring/recorder";

/** @param runId 当前运行。事件接收间隔与 SDK 实际工具耗时分别展示。 */
export function createToolRecorder(runId: string) {
  const started = new Map<string, number>();
  return {
    /** @param id SDK 调用标识。 @param toolName 注册工具名。 */
    async start(id: string, toolName: string) {
      started.set(id, Date.now());
      await recordObservation(runId, `tool:${id}`, "tool", {
        toolCallId: id,
        toolName,
        status: "started",
        observedDurationMs: null,
        resultCount: null,
      });
    },
    /** @param id SDK 调用标识。 @param toolName 工具名。 @param failed 是否明确失败。 @param output 仅提取结果数组长度和受限状态。 */
    async finish(
      id: string,
      toolName: string,
      failed: boolean,
      output?: unknown,
    ) {
      const result =
        output !== null && typeof output === "object"
          ? (output as Record<string, unknown>)
          : {};
      const items = [
        result.matches,
        result.sources,
        result.files,
        result.results,
      ].find(Array.isArray);
      const begin = started.get(id);
      await recordObservation(runId, `tool:${id}`, "tool", {
        toolCallId: id,
        toolName,
        status: failed ? "failed" : "completed",
        resultStatus:
          typeof result.status === "string" ? result.status.slice(0, 80) : null,
        resultCount: Array.isArray(items) ? items.length : null,
        observedDurationMs: begin === undefined ? null : Date.now() - begin,
      });
    },
  };
}
