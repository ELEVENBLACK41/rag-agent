/** 修改时间：2026-09-17 | 文件说明：逐 Run 模型步骤观测与脱敏白名单，管理记录不进入公开 SSE | edit by：Sliye */
import { runObservations } from "@/lib/db/schema";
import { withLockedRun } from "@/lib/chat/run-lifecycle";
import type { LanguageModelUsage } from "ai";
import type { ModelObservation } from "@/lib/monitoring/types";
import { createHash } from "node:crypto";
import { readGatewayCost } from "@/lib/monitoring/gateway-cost";

/** @param runId 当前运行。 @param id 稳定的观测标识。 @param kind 分类。 @param payload 仅允许调用处明确构造的脱敏字段。 */
export async function recordObservation(
  runId: string,
  id: string,
  kind: string,
  payload: Record<string, unknown>,
) {
  await withLockedRun(runId, async (tx, run) => {
    // 删除/取消/完成后禁止迟到写入；未完成请求在管理端显示用量未知。
    if (run.status !== "running") return;
    if (kind === "configuration") {
      await tx.insert(runObservations).values({ runId, observationId: id, kind, payload }).onConflictDoNothing();
      return;
    }
    await tx
      .insert(runObservations)
      .values({ runId, observationId: id, kind, payload })
      .onConflictDoUpdate({
        target: [runObservations.runId, runObservations.observationId],
        set: { payload },
      });
  });
}

/** @param usage SDK 实际报告；缓存和推理属于子项，不能再次加进总量。 */
function selectUsage(usage: LanguageModelUsage) {
  return {
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? null,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? null,
  };
}

/** @param runId 当前运行。 @param phase 模型职责。步骤级记录明确包含该步骤的工具执行时间。 */
export function createModelRecorder(
  runId: string,
  phase: ModelObservation["phase"],
) {
  let step = 0;
  let startedAt = new Date();
  let promptHashes: string[] = [];
  return {
    /** @param prompts 实际指令，仅记录哈希，不保存正文。 */
    setPromptHashes(prompts: string[]) {
      promptHashes = prompts.map((prompt) => createHash("sha256").update(prompt).digest("hex"));
    },
    /** 官方：https://ai-sdk.dev/docs/ai-sdk-core/telemetry；只选择模型与 usage，不保存完整回调对象。 */
    async onStepStart() {
      step += 1;
      startedAt = new Date();
      await recordObservation(runId, `${phase}:${step}`, "model", {
        kind: "model",
        phase,
        callId: `${phase}:${step}`,
        status: "started",
        startedAt: startedAt.toISOString(),
        durationMs: null,
        usage: null,
        costUsd: null,
      });
    },
    async onStepFinish(event: {
      usage: LanguageModelUsage;
      finishReason: string;
      response: { modelId: string };
      providerMetadata?: unknown;
      model: { provider: string };
      performance: { responseTimeMs: number; stepTimeMs: number; toolExecutionMs: Readonly<Record<string, number>>; timeToFirstOutputMs: number | undefined };
    }) {
      await recordObservation(runId, `${phase}:${step}`, "model", {
        kind: "model",
        phase,
        callId: `${phase}:${step}`,
        status: "completed",
        modelId: event.response.modelId,
        provider: event.model.provider,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        usage: selectUsage(event.usage),
        ...readGatewayCost(event.providerMetadata),
        finishReason: event.finishReason,
        modelResponseMs: event.performance.responseTimeMs,
        stepTimeMs: event.performance.stepTimeMs,
        toolExecutionMs: event.performance.toolExecutionMs,
        firstModelOutputMs: event.performance.timeToFirstOutputMs ?? null,
        promptHashes,
      });
    },
  };
}
