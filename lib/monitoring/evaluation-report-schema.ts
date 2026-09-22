/** 修改时间：2026-09-22 | 文件说明：脱离请求身份上下文的版本化评测报告格式 | edit by：Sliye */
import { z } from "zod";

/** 安全的报告文件名。 */
export const reportIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
/** 各项分数保留分子分母和缺失状态，供汇总与逐题复核使用。 */
const evaluationMetricSchema = z.object({
  value: z.number().finite().nullable(),
  numerator: z.number().finite().nullable(),
  denominator: z.number().finite().nullable(),
  unit: z.string(),
  source: z.enum(["deterministic", "human", "model"]),
});
/** 未评分为 null，不能以零代替；评分来源、分子分母与版本都显式保存。 */
export const evaluationReportSchema = z.object({
  version: z.literal("evaluation-report-v1"),
  id: reportIdSchema,
  createdAt: z.string().datetime(),
  datasetVersion: z.string().min(1),
  corpusHash: z.string().min(1),
  scorerVersion: z.string().min(1),
  configurationHash: z.string().min(1),
  promptHash: z.string().min(1),
  sourceReportId: reportIdSchema.optional(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  snapshotId: z.string().uuid().optional(),
  mode: z.enum(["retrieval", "answer", "both"]).optional(),
  parameters: z.record(z.string(), z.number().finite()).optional(),
  summary: z.record(z.string(), evaluationMetricSchema).optional(),
  splits: z.record(z.string(), z.record(z.string(), evaluationMetricSchema)).optional(),
  limitations: z.array(z.string().max(300)).optional(),
  cases: z.array(z.object({
    id: z.string().min(1),
    split: z.enum(["development", "holdout"]).optional(),
    category: z.string().optional(),
    runId: z.string().uuid().nullable(),
    status: z.enum(["passed", "failed", "unscored", "not-applicable"]),
    metrics: z.record(z.string(), evaluationMetricSchema),
    explanation: z.string().max(4000),
  })).max(1000),
});
