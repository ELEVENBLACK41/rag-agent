/**
 * 修改时间：2026-09-15
 * 文件说明：VaultAgent 三路问答执行编排。
 *
 * 本模块只选择 direct、retrieve、agent 路径并连接领域能力；回答流、过程流、事件
 * 顺序、来源读取和工具实现由对应模块负责。
 *
 * edit by：Sliye
 */

import { createVaultRunAgent } from "@/lib/agent/run-agent";
import { createVaultRunState } from "@/lib/agent/run-state";
import {
  createSourceCitations,
  describeSourceLocation,
} from "@/lib/agent/tools/source-presentation";
import {
  buildDirectInstruction,
  buildFinalInstruction,
  completeWithoutEvidence,
  streamFinalAnswer,
} from "@/lib/chat/answer-stream";
import { routeQuestion } from "@/lib/chat/query-router";
import { appendRunEvent } from "@/lib/chat/run-events";
import {
  createToolEvent,
  describeToolActivity,
  streamAgentEvents,
} from "@/lib/chat/run-process-stream";
import { failChatRun } from "@/lib/chat/run-store";
import type { ChatRun, ChatStreamEvent } from "@/lib/chat/run-types";
import { retrievePublishedChunksWithTrace } from "@/lib/retrieval/search";
import type { RetrievedChunk } from "@/lib/retrieval/types";
import { readSnapshotSources } from "@/lib/sources/reader";

/**
 * 路由当前问题，并执行直接回答、单次检索或受限 Agent 路径。
 *
 * @param chatRun 已持久化并固定快照的 Run。
 * @param question 已保存的当前用户问题。
 */
export async function* executeChatRun(
  chatRun: ChatRun,
  question: string,
): AsyncGenerator<ChatStreamEvent> {
  try {
    const route = await routeQuestion(question);
    await appendRunEvent(chatRun.runId, "query_routed", {
      version: "query-route-v1",
      mode: route.mode,
      query: route.query,
    });

    if (route.mode === "direct") {
      yield* streamFinalAnswer(
        chatRun,
        question,
        [],
        buildDirectInstruction(),
      );
      return;
    }

    const initialRetrievalId = `initial-retrieval:${chatRun.runId}`;
    yield await createToolEvent(chatRun.runId, {
      toolCallId: initialRetrievalId,
      toolName: "initial_retrieval",
      status: "started",
      message: describeToolActivity("initial_retrieval", "started"),
    });
    const initialRetrieval = await retrievePublishedChunksWithTrace(
      chatRun.snapshotId,
      route.query,
    );
    await appendRunEvent(
      chatRun.runId,
      "retrieval_trace",
      initialRetrieval.trace,
    );
    yield await createToolEvent(chatRun.runId, {
      toolCallId: initialRetrievalId,
      toolName: "initial_retrieval",
      status: "completed",
      message: describeToolActivity("initial_retrieval", "completed"),
    });

    if (route.mode === "retrieve") {
      yield* executeRetrievePath(chatRun, question, initialRetrieval.chunks);
      return;
    }

    yield* executeAgentPath(chatRun, question, initialRetrieval.chunks);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "知识问答执行失败。";
    await failChatRun(chatRun.runId, message);
    throw error;
  }
}

/** 单次检索路径直接读取前三条候选，不启动工具循环。 */
async function* executeRetrievePath(
  chatRun: ChatRun,
  question: string,
  candidates: RetrievedChunk[],
): AsyncGenerator<ChatStreamEvent> {
  const selectedCandidates = candidates.slice(0, 3);
  if (!selectedCandidates.length) {
    yield* completeWithoutEvidence(chatRun);
    return;
  }

  const sources = await readSnapshotSources(
    chatRun.snapshotId,
    selectedCandidates.map((candidate) => candidate.chunkId),
  );
  if (sources.length !== selectedCandidates.length)
    throw new Error("初始检索返回的部分来源当前不可用。");

  const citations = createSourceCitations(sources);
  yield* streamFinalAnswer(
    chatRun,
    question,
    citations,
    buildFinalInstruction(sources, citations),
  );
}

/** 多步骤路径复用初始候选，仅在状态允许时向 Agent 注册一次补搜。 */
async function* executeAgentPath(
  chatRun: ChatRun,
  question: string,
  candidates: RetrievedChunk[],
): AsyncGenerator<ChatStreamEvent> {
  const state = createVaultRunState(chatRun.snapshotId, {
    onRetrievalTrace: (trace) => appendRunEvent(
      chatRun.runId,
      "retrieval_trace",
      trace,
    ),
  });
  state.permitChunks(
    candidates.map((candidate) => candidate.chunkId),
    true,
  );

  const agent = createVaultRunAgent(state);
  const result = await agent.stream({
    prompt: buildAgentPrompt(question, candidates),
  });
  yield* streamAgentEvents(chatRun.runId, result.fullStream);

  const citations = state.getCitations();
  if (!citations.length) {
    yield* completeWithoutEvidence(chatRun);
    return;
  }
  const sources = await readSnapshotSources(
    chatRun.snapshotId,
    citations.map((citation) => citation.chunkId),
  );
  if (sources.length !== citations.length)
    throw new Error("Agent 已读取的部分证据当前不可用。");

  yield* streamFinalAnswer(
    chatRun,
    question,
    citations,
    buildFinalInstruction(sources, citations),
  );
}

/** 把初始候选转换为 Agent 可选择但不含正文的提示。 */
function buildAgentPrompt(question: string, candidates: RetrievedChunk[]) {
  const candidateList = candidates.length
    ? candidates
        .map(
          (candidate) => [
            `Chunk ID: ${candidate.chunkId}`,
            `来源: ${candidate.displayName}`,
            `位置: ${describeSourceLocation(candidate)}`,
          ].join(" | "),
        )
        .join("\n")
    : "初始检索没有找到候选，可针对明确证据缺口补充搜索一次。";

  return [
    `用户问题：${question}`,
    "服务器初始检索候选（尚未成为引用，必须通过 read_sources 阅读）：",
    candidateList,
  ].join("\n\n");
}

