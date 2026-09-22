/** 修改时间：2026-09-22 | 文件说明：固定题目调用真实问答链路并提取脱敏质量、用量与费用 | edit by：Sliye */
import { and, eq } from "drizzle-orm";
import { metric, scoreAnswer } from "./scoring.mjs";
import { getDatabase } from "../lib/db/client.ts";
import { messages, runEvents, runObservations, runs } from "../lib/db/schema.ts";
import { getLatestPublishedSnapshot } from "../lib/retrieval/search.ts";
import { createChatRun } from "../lib/chat/run-store.ts";
import { executeChatRun } from "../lib/chat/runs.ts";
import { failChatRun } from "../lib/chat/run-lifecycle.ts";
import { LOCAL_WORKSPACE_ID } from "../lib/ingestion/imports.ts";
import { RUN_DEADLINE_MS } from "../lib/chat/config.ts";

/** @param {number[]} values 同一类观测值；任何一步未知则整轮未知。 */
function sumKnown(values) {
  return values.length && values.every((value) => typeof value === "number" && Number.isFinite(value))
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

/**
 * 单题走现有 Agent 与回答链路，并只从持久观测提取量化数据。
 * @param {object} options 固定题目、快照、相关证据、人工复核与本轮检索参数。
 */
export async function evaluateAnswer({ item, snapshotId, relevant, review, tuning }) {
  const latest = await getLatestPublishedSnapshot(LOCAL_WORKSPACE_ID);
  if (latest?.id !== snapshotId) throw new Error("评测期间最新快照已改变，停止问答以保证固定语料。");
  const chatRun = await createChatRun(item.question, { webSearchEnabled: false });
  if (chatRun.snapshotId !== snapshotId) throw new Error("问答 Run 未固定到指定快照。");
  const signal = AbortSignal.timeout(RUN_DEADLINE_MS - 1000);
  try {
    for await (const event of executeChatRun(chatRun, item.question, {
      signal,
      retrievalTuning: tuning,
      assertActive: async () => {
        signal.throwIfAborted();
        const [run] = await getDatabase().select({ status: runs.status }).from(runs).where(eq(runs.id, chatRun.runId)).limit(1);
        if (run?.status !== "running") throw new Error("评测 Run 已终止。");
      },
    })) {
      if (event.type === "error") throw new Error("问答返回失败事件。");
    }
  } catch (error) {
    await failChatRun(chatRun.runId, "离线评测执行失败。");
    throw Object.assign(new Error("问答执行失败，已保存失败 Run。"), { runId: chatRun.runId, cause: error });
  }
  const db = getDatabase();
  const [answer] = await db.select({ content: messages.content, citations: messages.citations }).from(messages)
    .where(and(eq(messages.runId, chatRun.runId), eq(messages.role, "assistant"))).limit(1);
  const [run] = await db.select({ createdAt: runs.createdAt, completedAt: runs.completedAt, status: runs.status }).from(runs).where(eq(runs.id, chatRun.runId)).limit(1);
  if (!answer || run?.status !== "completed" || !run.completedAt) throw new Error("问答未产生已完成的回答。");
  const observations = await db.select({ payload: runObservations.payload }).from(runObservations)
    .where(and(eq(runObservations.runId, chatRun.runId), eq(runObservations.kind, "model")));
  const searchEvents = await db.select({ payload: runEvents.payload }).from(runEvents)
    .where(and(eq(runEvents.runId, chatRun.runId), eq(runEvents.eventType, "retrieval_trace")));
  const completed = observations.map((row) => row.payload).filter((payload) => payload.status === "completed");
  const modelCost = sumKnown(completed.map((payload) => payload.costUsd));
  const searchCosts = searchEvents.flatMap(({ payload }) => [payload?.execution?.embedding?.costUsd, payload?.rerank?.costUsd]);
  const searchCost = searchEvents.length ? sumKnown(searchCosts) : 0;
  const citationIds = Array.isArray(answer.citations) ? answer.citations.map((citation) => citation.chunkId).filter((id) => typeof id === "string") : [];
  const metrics = {
    ...scoreAnswer(answer.content, item.expectedAnswerFacts, citationIds, relevant),
    answer_ms: metric(run.completedAt.getTime() - run.createdAt.getTime(), null, null, "ms"),
    model_steps: metric(completed.length, null, null, "steps"),
    input_tokens: metric(sumKnown(completed.map((payload) => payload.usage?.inputTokens)), null, null, "tokens"),
    output_tokens: metric(sumKnown(completed.map((payload) => payload.usage?.outputTokens)), null, null, "tokens"),
    cache_read_tokens: metric(sumKnown(completed.map((payload) => payload.usage?.cacheReadTokens)), null, null, "tokens"),
    model_cost_usd: metric(modelCost, null, null, "USD"),
    answer_search_cost_usd: metric(searchCost, null, null, "USD"),
    answer_run_cost_usd: metric(modelCost !== null && searchCost !== null ? modelCost + searchCost : null, null, null, "USD"),
    research_cost_usd: metric(sumKnown(completed.filter((payload) => payload.phase === "research").map((payload) => payload.costUsd)), null, null, "USD"),
    answer_cost_usd: metric(sumKnown(completed.filter((payload) => payload.phase === "answer").map((payload) => payload.costUsd)), null, null, "USD"),
    task_success: metric(typeof review?.taskSuccess === "boolean" ? Number(review.taskSuccess) : null, null, 1, "ratio", "human"),
    supported_answer: metric(typeof review?.supported === "boolean" ? Number(review.supported) : null, null, 1, "ratio", "human"),
  };
  if (item.category === "unanswerable") metrics.abstention_correct = metric(typeof review?.abstainedCorrectly === "boolean" ? Number(review.abstainedCorrectly) : null, null, 1, "ratio", "human");
  return { runId: chatRun.runId, metrics, promptHashes: completed.flatMap((payload) => Array.isArray(payload.promptHashes) ? payload.promptHashes : []) };
}
