/** 修改时间：2026-09-17 | 文件说明：监控样本统计与明确缺失值，Token 子项不重复累加 | edit by：Sliye */
import { z } from "zod";

/** 只解析参与统计的字段，旧记录和不完整记录均保留为未知。 */
const usageSchema = z.object({
  totalTokens: z.number().nonnegative().nullable(),
  inputTokens: z.number().nonnegative().nullable(),
  outputTokens: z.number().nonnegative().nullable(),
});
const modelSchema = z.object({
  status: z.string(),
  usage: usageSchema.nullable(),
  costUsd: z.number().nonnegative().nullable(),
});

/** @param values 已过滤的真实完成时延。 @param percentile 0 到 1，采用 nearest-rank。 */
function quantile(values: number[], percentile: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)];
}

/** @param runs 当前筛选样本。 @param observations 与这些 Run 对应的观测。 */
export function summarizeRuns(
  runs: Array<{ status: string; createdAt: Date; completedAt: Date | null }>,
  observations: Array<{ kind: string; payload: Record<string, unknown> }>,
) {
  const durations = runs
    .filter((run) => run.completedAt !== null)
    .map((run) => run.completedAt!.getTime() - run.createdAt.getTime());
  const models = observations.filter(
    (observation) => observation.kind === "model",
  );
  const parsed = models
    .map((model) => modelSchema.safeParse(model.payload))
    .filter((result) => result.success)
    .map((result) => result.data);
  const knownUsage = parsed.filter((model) => model.usage?.totalTokens != null);
  const knownCosts = parsed.filter((model) => model.costUsd !== null);
  return {
    sampleCount: runs.length,
    completed: runs.filter((run) => run.status === "completed").length,
    failed: runs.filter((run) => run.status === "failed").length,
    running: runs.filter((run) => run.status === "running").length,
    cancelled: runs.filter((run) => run.status === "cancelled").length,
    durationSampleCount: durations.length,
    p50Ms: quantile(durations, 0.5),
    p95Ms: quantile(durations, 0.95),
    modelCalls: models.length,
    knownUsageCalls: knownUsage.length,
    totalTokens: knownUsage.length
      ? knownUsage.reduce(
          (total, model) => total + model.usage!.totalTokens!,
          0,
        )
      : null,
    knownCostCalls: knownCosts.length,
    costUsd: knownCosts.length
      ? knownCosts.reduce((total, model) => total + model.costUsd!, 0)
      : null,
  };
}
