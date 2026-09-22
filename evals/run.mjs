/** 修改时间：2026-09-22 | 文件说明：固定快照上执行 60 条检索与问答评测并写入脱敏报告 | edit by：Sliye */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { cases, datasetVersion } from "./classic/dataset.mjs";
import { scoreRetrieval, summarizeEvaluation } from "./scoring.mjs";
import { verifySnapshot, resolveEvidence } from "./snapshot.mjs";
import { evaluateAnswer } from "./answer-run.mjs";
import { getEffectiveConfiguration } from "../lib/monitoring/configuration.ts";
import { evaluationReportSchema } from "../lib/monitoring/evaluation-report-schema.ts";
import { retrievePublishedChunksWithTrace } from "../lib/retrieval/search.ts";

/** 参数边界与 SQL 候选上限对齐；所有覆盖只作用于直接检索评测。 */
const argumentsSchema = z.object({
  snapshot: z.string().uuid(),
  mode: z.enum(["retrieval", "answer", "both"]),
  split: z.enum(["all", "development", "holdout"]).default("all"),
  case: z.string().regex(/^[a-z][0-9]{2}$/).optional(),
  keywordLimit: z.coerce.number().int().min(1).max(50).optional(),
  vectorLimit: z.coerce.number().int().min(1).max(50).optional(),
  rerankLimit: z.coerce.number().int().min(1).max(50).optional(),
  finalLimit: z.coerce.number().int().min(1).max(12).optional(),
  rrfConstant: z.coerce.number().int().min(1).max(200).optional(),
  rerankTimeoutMs: z.coerce.number().int().min(1000).max(30000).optional(),
  reviews: z.string().optional(),
});
/** 此目录只存脱敏统计，禁止保存问题、正文或原始模型错误。 */
const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** 当前检索配置作为覆盖参数的默认值。 */
const defaultTuning = getEffectiveConfiguration().retrieval;

/** @param {string} value 待计算哈希的稳定文本或字节内容。 */
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

/** @param {string[]} argumentsList 命令行参数，格式为 --名称=值。 */
function parseArguments(argumentsList) {
  const raw = {};
  for (const argument of argumentsList) {
    const match = /^--([a-z][a-z-]*)=(.+)$/.exec(argument);
    if (!match) throw new Error(`参数格式错误：${argument}`);
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (key in raw) throw new Error(`重复参数：${key}`);
    raw[key] = match[2];
  }
  const parsed = argumentsSchema.parse(raw);
  const tuning = {
    keywordCandidateLimit: parsed.keywordLimit ?? defaultTuning.RETRIEVAL_CANDIDATE_LIMIT,
    vectorCandidateLimit: parsed.vectorLimit ?? defaultTuning.RETRIEVAL_CANDIDATE_LIMIT,
    rerankCandidateLimit: parsed.rerankLimit ?? defaultTuning.RERANK_CANDIDATE_LIMIT,
    finalLimit: parsed.finalLimit ?? defaultTuning.FINAL_RETRIEVAL_LIMIT,
    rrfRankConstant: parsed.rrfConstant ?? defaultTuning.RRF_RANK_CONSTANT,
    rerankTimeoutMs: parsed.rerankTimeoutMs ?? defaultTuning.RERANK_TIMEOUT_MS,
  };
  if (tuning.finalLimit > tuning.rerankCandidateLimit) throw new Error("最终证据上限不能超过 rerank 候选上限。");
  return { ...parsed, tuning };
}

/** @param {string} pathname 可选人工复核结果 JSON 路径。 */
async function loadReviews(pathname) {
  if (!pathname) return {};
  const schema = z.record(z.string(), z.object({ taskSuccess: z.boolean().optional(), supported: z.boolean().optional(), abstainedCorrectly: z.boolean().optional() }).strict());
  return schema.parse(JSON.parse(await readFile(path.resolve(pathname), "utf8")));
}

/** 主执行顺序固定，避免并发 Gateway 请求扰乱费用与速率限制观测。 */
async function main() {
  const options = parseArguments(process.argv.slice(2));
  const selected = cases.filter((item) => (options.split === "all" || item.split === options.split) && (!options.case || item.id === options.case));
  if (cases.length !== 60 || cases.filter((item) => item.split === "development").length !== 40 || selected.length === 0) throw new Error("固定集条数或切分不符合版本定义。");
  const corpusHash = await verifySnapshot(options.snapshot);
  const gold = await resolveEvidence(options.snapshot, selected);
  const reviews = await loadReviews(options.reviews);
  const reportCases = [];
  const promptHashes = [];
  for (const [index, item] of selected.entries()) {
    const metrics = {};
    let runId = null;
    let status = "unscored";
    let explanation = "";
    try {
      if (options.mode !== "answer") {
        const result = await retrievePublishedChunksWithTrace(options.snapshot, item.question, { tuning: options.tuning });
        Object.assign(metrics, scoreRetrieval(result.trace, gold.get(item.id)));
        status = result.trace.vectorStatus === "fallback" || result.trace.rerank.status === "fallback" ? "unscored" : "passed";
        explanation = status === "unscored" ? "检索发生服务降级；候选与耗时保留，质量不作为完整链路结论。" : "已按固定快照和证据标注计算检索指标。";
      }
      if (options.mode !== "retrieval") {
        const answer = await evaluateAnswer({ item, snapshotId: options.snapshot, relevant: gold.get(item.id), review: reviews[item.id], tuning: options.tuning });
        runId = answer.runId;
        Object.assign(metrics, answer.metrics);
        promptHashes.push(...answer.promptHashes);
        status = typeof answer.metrics.task_success.value === "number" ? (answer.metrics.task_success.value === 1 ? "passed" : "failed") : "unscored";
        explanation = "回答已完成；字面事实为代理指标，任务成功与无答案正确性以人工复核为准。";
      }
    } catch (error) {
      runId = error?.runId ?? runId;
      status = "failed";
      explanation = error instanceof Error && error.message.startsWith("评测期间最新快照已改变") ? error.message : "评测执行失败；本题缺失值不计作零。";
      console.error(`${item.id} 失败类别：${error?.cause?.name ?? error?.name ?? "unknown"}`);
    }
    reportCases.push({ id: item.id, runId, split: item.split, category: item.category, status, metrics, explanation });
    console.log(`${index + 1}/${selected.length} ${item.id} ${status}`);
    if (status === "failed" && explanation.includes("快照已改变")) break;
  }
  const configuration = getEffectiveConfiguration();
  const { summary, splits } = summarizeEvaluation(reportCases);
  const report = {
    version: "evaluation-report-v1",
    id: `classic-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}-${options.mode}-${options.split}-${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    datasetVersion,
    corpusHash,
    scorerVersion: "classic-scorer-v2",
    configurationHash: sha256(JSON.stringify({ configuration: configuration.hash, tuning: options.tuning, mode: options.mode })),
    promptHash: sha256(JSON.stringify(promptHashes.length ? promptHashes : ["direct-retrieval-v1"])),
    snapshotId: options.snapshot,
    mode: options.mode,
    parameters: options.tuning,
    summary,
    splits,
    limitations: ["字面事实指标不能代替语义人工复核。", "费用仅采用 Gateway 当前请求实报金额；任一步缺失则回答整轮费用未知，导入费用另计。", "无答案题的正确性需要人工复核。"],
    cases: reportCases,
  };
  const directory = path.join(projectDirectory, "evals", "reports");
  evaluationReportSchema.parse(report);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${report.id}.json`), JSON.stringify(report, null, 2), { encoding: "utf8", flag: "wx" });
  console.log(`报告：evals/reports/${report.id}.json`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "评测启动失败。");
  process.exit(1);
});
