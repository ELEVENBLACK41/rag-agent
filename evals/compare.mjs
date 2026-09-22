/** 修改时间：2026-09-22 | 文件说明：同固定集两份报告的参数与质量差异对比 | edit by：Sliye */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { summarize } from "./scoring.mjs";

/** @param {string} pathname 用户明确指定的本地报告文件。 */
async function loadReport(pathname) {
  const report = JSON.parse(await readFile(resolve(pathname), "utf8"));
  if (report.version !== "evaluation-report-v1" || !Array.isArray(report.cases) || !report.summary) throw new Error("报告缺少固定评测汇总。");
  return report;
}

/** 只比较同一资料和评分版本；候选可选开发集子集，答案指标只在双边都有时比较。 */
async function main() {
  if (process.argv.length !== 4) throw new Error("用法：pnpm eval:compare <基线报告.json> <候选报告.json>");
  const [baseline, candidate] = await Promise.all(process.argv.slice(2).map(loadReport));
  for (const key of ["datasetVersion", "corpusHash", "scorerVersion"]) {
    if (baseline[key] !== candidate[key]) throw new Error(`两份报告的 ${key} 不一致，不能直接比较。`);
  }
  const baselineById = new Map(baseline.cases.map((item) => [item.id, item]));
  const baselineCases = candidate.cases.map((item) => baselineById.get(item.id));
  if (baselineCases.some((item) => !item)) throw new Error("候选报告包含基线中不存在的题目。");
  const baselineSummary = summarize(baselineCases);
  const candidateSummary = summarize(candidate.cases);
  const retrievalNames = ["keyword_hit@10", "vector_hit@10", "fused_recall@10", "final_recall@6", "final_mrr@6", "final_ndcg@6", "retrieval_ms", "retrieval_ms_p50", "retrieval_ms_p95", "rerank_ms", "embedding_cost_usd", "rerank_cost_usd", "vector_fallback", "rerank_fallback"];
  const answerNames = ["literal_fact_recall", "citation_precision", "citation_recall", "strict_fact_citation_pass", "task_success", "abstention_correct", "answer_ms_p50", "answer_ms_p95", "model_cost_usd", "answer_run_cost_usd"];
  const names = baseline.mode !== "answer" && candidate.mode !== "answer" ? retrievalNames : [];
  if (baseline.mode !== "retrieval" && candidate.mode !== "retrieval") names.push(...answerNames);
  if (!names.length) throw new Error("两份报告没有可比较的共同评测阶段。");
  console.log(`基线 ${baseline.id}，候选 ${candidate.id}`);
  console.log(`共同题目：${candidate.cases.length} 题；模式：${baseline.mode} → ${candidate.mode}`);
  console.log(`参数：${JSON.stringify(baseline.parameters)} → ${JSON.stringify(candidate.parameters)}`);
  console.log("指标\t基线\t候选\t变化");
  for (const name of names) {
    const left = baselineSummary[name]?.value;
    const right = candidateSummary[name]?.value;
    if (typeof left !== "number" && typeof right !== "number") continue;
    const unit = candidateSummary[name]?.unit ?? baselineSummary[name]?.unit;
    const format = (value) => typeof value !== "number" ? "未采集" : unit === "USD" ? value.toFixed(8) : unit === "ms" ? value.toFixed(1) : value.toFixed(4);
    console.log(`${name}\t${format(left)}\t${format(right)}\t${typeof left === "number" && typeof right === "number" ? format(right - left) : "不可比较"}`);
  }
  if (baseline.mode !== "retrieval" && candidate.mode !== "retrieval") console.log("回答质量中的人工指标只比较已完成复核的样本；模型费用不含 Embedding、rerank 与导入。");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "报告对比失败。");
  process.exitCode = 1;
});
