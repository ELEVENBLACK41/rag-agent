/** 修改时间：2026-09-22 | 文件说明：无需重跑模型即可给已有固定评测报告补录人工质量复核 | edit by：Sliye */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { metric, summarizeEvaluation } from "./scoring.mjs";
import { evaluationReportSchema } from "../lib/monitoring/evaluation-report-schema.ts";

/** 复核只传布尔结论，不把回答正文复制进报告。 */
const reviewSchema = z.record(z.string(), z.object({
  taskSuccess: z.boolean().optional(),
  supported: z.boolean().optional(),
  abstainedCorrectly: z.boolean().optional(),
}).strict());
/** 报告固定输出目录。 */
const reportsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "reports");

/** @param {string} pathname 已生成报告路径。 */
async function loadReport(pathname) {
  return evaluationReportSchema.parse(JSON.parse(await readFile(path.resolve(pathname), "utf8")));
}

/** 只更新已完成 Run 的人工指标，未复核和执行失败继续保持原状态。 */
async function main() {
  if (process.argv.length !== 4) throw new Error("用法：pnpm eval:review <原报告.json> <复核结果.json>");
  const [source, reviewBytes] = await Promise.all([loadReport(process.argv[2]), readFile(path.resolve(process.argv[3]))]);
  const reviews = reviewSchema.parse(JSON.parse(reviewBytes.toString("utf8")));
  const available = new Set(source.cases.map((item) => item.id));
  for (const id of Object.keys(reviews)) if (!available.has(id)) throw new Error(`复核题目不在报告中：${id}`);
  const cases = source.cases.map((item) => {
    const review = reviews[item.id];
    if (!review) return item;
    if (!item.runId || !item.metrics.answer_ms) throw new Error(`题目没有已完成回答，不能复核：${item.id}`);
    const metrics = {
      ...item.metrics,
      task_success: metric(typeof review.taskSuccess === "boolean" ? Number(review.taskSuccess) : item.metrics.task_success?.value ?? null, null, 1, "ratio", "human"),
      supported_answer: metric(typeof review.supported === "boolean" ? Number(review.supported) : item.metrics.supported_answer?.value ?? null, null, 1, "ratio", "human"),
    };
    if (item.category === "unanswerable") metrics.abstention_correct = metric(typeof review.abstainedCorrectly === "boolean" ? Number(review.abstainedCorrectly) : item.metrics.abstention_correct?.value ?? null, null, 1, "ratio", "human");
    return { ...item, metrics, status: metrics.task_success.value === null ? "unscored" : metrics.task_success.value === 1 ? "passed" : "failed", explanation: "已补录人工复核；自动代理指标与原始 Run 保持不变。" };
  });
  const report = {
    ...source,
    id: `${Object.keys(reviews).length ? "review" : "rescore"}-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}-${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    scorerVersion: "classic-scorer-v2",
    sourceReportId: source.id,
    reviewHash: createHash("sha256").update(reviewBytes).digest("hex"),
    ...summarizeEvaluation(cases),
    cases,
  };
  evaluationReportSchema.parse(report);
  await mkdir(reportsDirectory, { recursive: true });
  await writeFile(path.join(reportsDirectory, `${report.id}.json`), JSON.stringify(report, null, 2), { encoding: "utf8", flag: "wx" });
  console.log(`新报告：evals/reports/${report.id}.json`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "复核失败。");
  process.exitCode = 1;
});
