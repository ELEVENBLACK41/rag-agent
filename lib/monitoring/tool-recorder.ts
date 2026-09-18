/** 修改时间：2026-09-18 | 文件说明：按真实工具调用 ID 记录结果状态、数量与脱敏错误类型，不保存参数或正文 | edit by：Sliye */
import { InvalidToolInputError, NoSuchToolError } from "ai";
import { recordObservation } from "@/lib/monitoring/recorder";

/** 将 SDK 错误压缩为稳定类别，不把参数、正文或原始异常写入管理观测。 */
function classifyToolError(error: unknown) {
  if (NoSuchToolError.isInstance(error)) return "tool-not-available";
  if (InvalidToolInputError.isInstance(error)) return "invalid-tool-input";
  return error === undefined ? null : "tool-execution-error";
}

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
    /** @param id SDK 调用标识。 @param toolName 工具名。 @param failed 是否明确失败。 @param output 仅提取结果数组长度和受限状态。 @param error 仅用于生成脱敏错误类别。 */
    async finish(
      id: string,
      toolName: string,
      failed: boolean,
      output?: unknown,
      error?: unknown,
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
        errorKind: failed ? classifyToolError(error) : null,
        resultStatus:
          typeof result.status === "string" ? result.status.slice(0, 80) : null,
        resultCount: Array.isArray(items) ? items.length : null,
        observedDurationMs: begin === undefined ? null : Date.now() - begin,
      });
    },
  };
}
