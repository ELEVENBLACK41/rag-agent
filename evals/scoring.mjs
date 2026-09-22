/** 修改时间：2026-09-22 | 文件说明：固定证据、字面事实和人工复核的离线量化口径 | edit by：Sliye */

/** @param {number|null} value 分数或测量值。 @param {number|null} numerator 分子。 @param {number|null} denominator 分母。 @param {string} unit 单位。 @param {'deterministic'|'human'|'model'} source 评分来源。 */
export function metric(value, numerator = null, denominator = null, unit = "ratio", source = "deterministic") {
  return { value, numerator, denominator, unit, source };
}

/**
 * 只对已完整标注的相关 Chunk 集计算排名指标；无答案题不混入召回分母。
 * @param {string[]} ranking 某一阶段按名次排列的 Chunk ID。
 * @param {Set<string>} relevant 当前快照中已解析的全部相关 Chunk ID。
 * @param {number} k 固定截断位置；不足 K 的位置视为未命中。
 */
export function rankMetrics(ranking, relevant, k) {
  if (!relevant.size) return null;
  const selected = ranking.slice(0, k);
  const hits = selected.filter((id) => relevant.has(id)).length;
  const first = ranking.findIndex((id) => relevant.has(id));
  const dcg = selected.reduce((sum, id, index) => sum + (relevant.has(id) ? 1 / Math.log2(index + 2) : 0), 0);
  const ideal = Array.from({ length: Math.min(relevant.size, k) }, (_, index) => 1 / Math.log2(index + 2)).reduce((sum, value) => sum + value, 0);
  return {
    hit: metric(Number(hits > 0), Number(hits > 0), 1),
    recall: metric(hits / relevant.size, hits, relevant.size),
    precision: metric(hits / k, hits, k),
    mrr: metric(first >= 0 && first < k ? 1 / (first + 1) : 0, first >= 0 && first < k ? 1 / (first + 1) : 0, 1),
    ndcg: metric(dcg / ideal, dcg, ideal),
  };
}

/** @param {object} trace 真实检索 Trace。 @param {Set<string>} relevant 固定快照解析后的标注集合。 */
export function scoreRetrieval(trace, relevant) {
  const result = {};
  const stages = [
    ["keyword", trace.keywordCandidateIds, 10],
    ["vector", trace.vectorCandidateIds, 10],
    ["fused", trace.fusedCandidateIds, 10],
    ["final", trace.finalChunkIds, 6],
  ];
  for (const [name, ranking, k] of stages) {
    const scores = rankMetrics(ranking, relevant, k);
    if (scores) for (const [key, value] of Object.entries(scores)) result[`${name}_${key}@${k}`] = value;
  }
  result.retrieval_ms = metric(trace.execution?.durationMs ?? null, null, null, "ms");
  result.keyword_ms = metric(trace.execution?.keywordMs ?? null, null, null, "ms");
  result.vector_ms = metric(trace.execution?.vectorMs ?? null, null, null, "ms");
  result.fusion_ms = metric(trace.execution?.fusionMs ?? null, null, null, "ms");
  result.rerank_ms = metric(trace.rerank.durationMs, null, null, "ms");
  result.keyword_candidates = metric(trace.keywordCandidateIds.length, null, null, "chunks");
  result.vector_candidates = metric(trace.vectorCandidateIds.length, null, null, "chunks");
  result.fused_candidates = metric(trace.fusedCandidateIds.length, null, null, "chunks");
  result.final_candidates = metric(trace.finalChunkIds.length, null, null, "chunks");
  result.vector_fallback = metric(Number(trace.vectorStatus === "fallback"), Number(trace.vectorStatus === "fallback"), 1);
  result.rerank_fallback = metric(Number(trace.rerank.status === "fallback"), Number(trace.rerank.status === "fallback"), 1);
  result.embedding_tokens = metric(trace.execution?.embedding?.tokens ?? null, null, null, "tokens");
  result.embedding_cost_usd = metric(trace.execution?.embedding?.costUsd ?? null, null, null, "USD");
  result.rerank_cost_usd = metric(trace.rerank.status === "completed" ? trace.rerank.costUsd ?? null : null, null, null, "USD");
  return result;
}

/**
 * 字面事实是可重复的代理指标，复杂语义正确性只能由人工复核项确认。
 * @param {string} answer 本轮真实回答。
 * @param {string[]} expectedFacts 预先标注的关键事实文本。
 * @param {string[]} citations 回答实际引用的 Chunk ID。
 * @param {Set<string>} relevant 当前快照解析后的相关 Chunk ID。
 */
export function scoreAnswer(answer, expectedFacts, citations, relevant) {
  if (!expectedFacts.length) return {};
  const normalized = answer.replace(/\s+/g, "").toLowerCase();
  const found = expectedFacts.filter((fact) => normalized.includes(fact.replace(/\s+/g, "").toLowerCase())).length;
  const uniqueCitations = [...new Set(citations)];
  const correctCitations = uniqueCitations.filter((id) => relevant.has(id)).length;
  return {
    literal_fact_recall: metric(found / expectedFacts.length, found, expectedFacts.length),
    citation_precision: metric(uniqueCitations.length ? correctCitations / uniqueCitations.length : null, correctCitations, uniqueCitations.length),
    citation_presence: metric(Number(uniqueCitations.length > 0), Number(uniqueCitations.length > 0), 1),
    citation_recall: metric(correctCitations / relevant.size, correctCitations, relevant.size),
    strict_fact_citation_pass: metric(Number(found === expectedFacts.length && correctCitations === relevant.size && uniqueCitations.length === correctCitations), Number(found === expectedFacts.length && correctCitations === relevant.size && uniqueCitations.length === correctCitations), 1),
  };
}

/** @param {Array<object>} cases 已评分的逐题报告；缺失值不作为零。 */
export function summarize(cases) {
  const values = new Map();
  for (const item of cases) for (const [name, measurement] of Object.entries(item.metrics)) {
    if (measurement.value === null) continue;
    const entries = values.get(name) ?? [];
    entries.push(measurement.value);
    values.set(name, entries);
  }
  const summary = {};
  for (const [name, entries] of values) {
    const sorted = [...entries].sort((a, b) => a - b);
    summary[name] = metric(entries.reduce((sum, value) => sum + value, 0) / entries.length, entries.reduce((sum, value) => sum + value, 0), entries.length, cases.find((item) => item.metrics[name])?.metrics[name].unit ?? "ratio");
    if (name.endsWith("_ms")) {
      summary[`${name}_p50`] = metric(sorted[Math.ceil(sorted.length * 0.5) - 1], null, entries.length, "ms");
      summary[`${name}_p95`] = metric(sorted[Math.ceil(sorted.length * 0.95) - 1], null, entries.length, "ms");
    }
  }
  summary.cases_total = metric(cases.length, null, null, "cases");
  summary.cases_failed = metric(cases.filter((item) => item.status === "failed").length, null, null, "cases");
  summary.cases_execution_failed = metric(cases.filter((item) => item.status === "failed" && !item.metrics.answer_ms).length, null, null, "cases");
  summary.cases_quality_failed = metric(cases.filter((item) => item.status === "failed" && item.metrics.task_success?.value === 0).length, null, null, "cases");
  return summary;
}

/** 为版本报告同时汇总全部题和来源主题切分；费用只在覆盖完整时求总额。 */
export function summarizeEvaluation(cases) {
  const summary = summarize(cases);
  const attempted = cases.filter((item) => item.runId !== null);
  const answered = attempted.filter((item) => item.metrics.model_cost_usd);
  const modelCosted = attempted.filter((item) => typeof item.metrics.model_cost_usd?.value === "number");
  const fullCosted = attempted.filter((item) => typeof item.metrics.answer_run_cost_usd?.value === "number");
  const reviewed = answered.filter((item) => typeof item.metrics.task_success?.value === "number");
  const successes = reviewed.filter((item) => item.metrics.task_success.value === 1).length;
  summary.review_coverage = metric(answered.length ? reviewed.length / answered.length : null, reviewed.length, answered.length);
  summary.model_cost_coverage = metric(attempted.length ? modelCosted.length / attempted.length : null, modelCosted.length, attempted.length);
  summary.answer_run_cost_coverage = metric(attempted.length ? fullCosted.length / attempted.length : null, fullCosted.length, attempted.length);
  summary.observed_model_cost_usd = metric(modelCosted.length ? modelCosted.reduce((sum, item) => sum + item.metrics.model_cost_usd.value, 0) : null, null, null, "USD");
  summary.observed_answer_run_cost_usd = metric(fullCosted.length ? fullCosted.reduce((sum, item) => sum + item.metrics.answer_run_cost_usd.value, 0) : null, null, null, "USD");
  summary.total_model_cost_usd = metric(attempted.length && modelCosted.length === attempted.length ? summary.observed_model_cost_usd.value : null, null, null, "USD");
  summary.total_answer_run_cost_usd = metric(attempted.length && fullCosted.length === attempted.length ? summary.observed_answer_run_cost_usd.value : null, null, null, "USD");
  summary.model_cost_per_success_usd = metric(summary.total_model_cost_usd.value !== null && reviewed.length === answered.length && successes ? summary.total_model_cost_usd.value / successes : null, null, successes || null, "USD");
  summary.answer_run_cost_per_success_usd = metric(summary.total_answer_run_cost_usd.value !== null && reviewed.length === answered.length && successes ? summary.total_answer_run_cost_usd.value / successes : null, null, successes || null, "USD");
  return {
    summary,
    splits: Object.fromEntries(["development", "holdout"].map((split) => [split, summarize(cases.filter((item) => item.split === split))])),
  };
}
