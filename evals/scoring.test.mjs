/** 修改时间：2026-09-22 | 文件说明：固定集评分口径的关键回归验证 | edit by：Sliye */
import assert from "node:assert/strict";
import test from "node:test";
import { cases } from "./classic/dataset.mjs";
import { rankMetrics, scoreAnswer, summarize, summarizeEvaluation, metric } from "./scoring.mjs";

test("固定集恰有 60 题且开发与留出题按资料隔离", () => {
  assert.equal(cases.length, 60);
  assert.equal(new Set(cases.map((item) => item.id)).size, 60);
  assert.equal(cases.filter((item) => item.split === "development").length, 40);
  assert.equal(cases.filter((item) => item.split === "holdout").length, 20);
  const development = new Set(cases.filter((item) => item.split === "development").flatMap((item) => item.expectedEvidence.map((evidence) => evidence.file)));
  const holdout = new Set(cases.filter((item) => item.split === "holdout").flatMap((item) => item.expectedEvidence.map((evidence) => evidence.file)));
  assert.deepEqual([...development].filter((file) => holdout.has(file)), []);
});

test("失败 Run 的未知费用降低覆盖率，不能把已知金额冒充全量总额", () => {
  const { summary } = summarizeEvaluation([
    { split: "development", runId: "completed", status: "unscored", metrics: { model_cost_usd: metric(0.01, null, null, "USD"), task_success: metric(null, null, 1, "ratio", "human") } },
    { split: "development", runId: "failed", status: "failed", metrics: {} },
  ]);
  assert.equal(summary.model_cost_coverage.value, 0.5);
  assert.equal(summary.observed_model_cost_usd.value, 0.01);
  assert.equal(summary.total_model_cost_usd.value, null);
});

test("多个相关证据必须全部命中才得到完整召回，缺少的名次不充数", () => {
  const result = rankMetrics(["irrelevant", "a"], new Set(["a", "b"]), 6);
  assert.equal(result.hit.value, 1);
  assert.equal(result.recall.value, 0.5);
  assert.equal(result.precision.value, 1 / 6);
  assert.equal(result.mrr.value, 0.5);
});

test("额外错误引用不能通过严格事实与引用检查，未复核与无答案不冒充零分", () => {
  const result = scoreAnswer("目标是 48 小时", ["48 小时"], ["a", "wrong"], new Set(["a"]));
  assert.equal(result.literal_fact_recall.value, 1);
  assert.equal(result.citation_precision.value, 0.5);
  assert.equal(result.strict_fact_citation_pass.value, 0);
  assert.deepEqual(scoreAnswer("未查到", [], [], new Set()), {});
  assert.equal(summarize([{ status: "unscored", metrics: { review: { value: null, numerator: null, denominator: 1, unit: "ratio", source: "human" } } }]).review, undefined);
});
