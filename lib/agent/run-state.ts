/**
 * 修改时间：2026-09-15
 * 文件说明：VaultAgent D10 单次多步问答的工具与证据预算状态。
 *
 * State 只在当前服务器执行内存活，固定绑定一个索引快照。它不保存模型思维过程，
 * 只保存工具访问范围、调用数量和用户可见的已阅读证据。
 *
 * edit by：Sliye
 */

import type { RetrievalTrace } from "@/lib/retrieval/types";
import type { SourceCitation } from "@/lib/sources/types";

/** 单次问答最多调用的只读工具次数，限制模型循环和费用。 */
export const MAX_AGENT_TOOL_CALLS = 5;
/** 一次读取最多带回给模型的 Chunk 数。 */
export const MAX_READ_CHUNKS_PER_CALL = 3;
/** 单个 Chunk 交给模型的最大字符数，避免上下文被文件正文占满。 */
export const MAX_SOURCE_CHARACTERS = 2_400;

export type VaultRunStateOptions = {
  onRetrievalTrace: (trace: RetrievalTrace) => Promise<void>;
};

/** 创建一个只属于当前 Run 的受限工具执行状态。 */
export function createVaultRunState(snapshotId: string, options: VaultRunStateOptions) {
  const permittedChunkIds = new Set<string>();
  const citations = new Map<string, SourceCitation>();
  let toolCallCount = 0;
  let supplementalSearchCount = 0;
  let sourceReadRequired = false;

  /** 在闭包内统一消耗工具预算，供普通工具和补搜共同使用。 */
  function beginToolCall() {
    if (toolCallCount >= MAX_AGENT_TOOL_CALLS)
      throw new Error("本次问答已达到工具调用上限。");
    toolCallCount += 1;
  }

  return {
    snapshotId,
    /** 记录一次工具开始；超出预算必须显式失败而非静默继续。 */
    beginToolCall,
    /**
     * 只有服务器检索返回的 Chunk 才能进入后续读取。
     * @param chunkIds 本次检索返回的候选标识。
     * @param requireRead 是否要求下一模型步骤先读取新增候选。
     */
    permitChunks(chunkIds: string[], requireRead = false) {
      for (const chunkId of chunkIds) permittedChunkIds.add(chunkId);
      if (
        requireRead &&
        chunkIds.some((chunkId) => !citations.has(chunkId))
      ) sourceReadRequired = true;
    },
    /** 供 Agent 步骤门禁判断搜索是否得到可读取候选。 */
    getPermittedChunkCount() {
      return permittedChunkIds.size;
    },
    /** 防止模型构造任意 Chunk ID 绕过检索范围。 */
    assertReadable(chunkIds: string[]) {
      if (chunkIds.some((chunkId) => !permittedChunkIds.has(chunkId)))
        throw new Error("只能读取本次搜索返回的来源片段。");
    },
    /** 相邻上下文只能从已成为证据的 Chunk 扩展，不能绕过首次读取。 */
    assertCited(chunkId: string) {
      if (!citations.has(chunkId))
        throw new Error("只能围绕已经读取的证据扩展上下文。");
    },
    /** 读取成功后才进入最终回答的引用集合。 */
    addCitation(citation: Omit<SourceCitation, "id">) {
      if (citations.has(citation.chunkId)) return citations.get(citation.chunkId)!;
      const completed = { ...citation, id: citations.size + 1 };
      citations.set(completed.chunkId, completed);
      sourceReadRequired = false;
      return completed;
    },
    /** 按证据首次读取的顺序输出稳定引用编号。 */
    getCitations() {
      return [...citations.values()];
    },
    /** 供 Agent 步骤门禁判断是否已经读取真实证据。 */
    getCitationCount() {
      return citations.size;
    },
    /** 初始检索或补搜得到新候选后，下一步骤必须先读取证据。 */
    needsSourceRead() {
      return sourceReadRequired;
    },
    /** 没有初始候选，或已经读取过初始证据时，才允许唯一一次补搜。 */
    canSupplementalSearch() {
      return supplementalSearchCount === 0 &&
        (permittedChunkIds.size === 0 || citations.size > 0);
    },
    /** 消耗一次工具和补搜预算；不满足前置条件时显式失败。 */
    beginSupplementalSearch() {
      if (
        supplementalSearchCount > 0 ||
        (permittedChunkIds.size > 0 && citations.size === 0)
      ) throw new Error("请先读取初始候选；本次 Run 最多补充搜索一次。");
      beginToolCall();
      supplementalSearchCount += 1;
    },
    recordRetrievalTrace(trace: RetrievalTrace) {
      return options.onRetrievalTrace(trace);
    },
  };
}

export type VaultRunState = ReturnType<typeof createVaultRunState>;
