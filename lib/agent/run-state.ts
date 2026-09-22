/**
 * 修改时间：2026-09-22
 * 文件说明：VaultAgent 单次多步问答的工具与证据预算状态。
 *
 * State 只在当前服务器执行内存活，固定绑定一个索引快照。它不保存模型思维过程，
 * 只保存工具访问范围、调用数量和用户可见的已阅读证据。
 *
 * edit by：Sliye
 */

import type { RetrievalTrace } from "@/lib/retrieval/types";
import type { SourceCitation } from "@/lib/sources/types";

/** 单次问答最多调用的只读工具次数，为二次检索与证据核对预留空间。 */
export const MAX_AGENT_TOOL_CALLS = 10;
/** 搜索和关联检索共享上限，为读取证据保留调用空间。 */
export const MAX_AGENT_SEARCH_CALLS = 5;
/** 一次读取最多带回给模型的 Chunk 数。 */
export const MAX_READ_CHUNKS_PER_CALL = 5;
/** 单个 Chunk 交给模型的最大字符数，避免上下文被文件正文占满。 */
export const MAX_SOURCE_CHARACTERS = 2_400;

export type VaultRunStateOptions = {
  onRetrievalTrace: (trace: RetrievalTrace) => Promise<void>;
  /** 离线评测本轮检索配置；普通 Run 不传。 */
  retrievalTuning?: Partial<RetrievalTrace["config"]>;
};

/** 创建一个只属于当前 Run 的受限工具执行状态。 */
export function createVaultRunState(snapshotId: string | null, options: VaultRunStateOptions) {
  const permittedChunkIds = new Set<string>();
  const citations = new Map<string, SourceCitation>();
  let toolCallCount = 0;
  /** 规范化搜索问题或关联来源，阻止相同操作重复访问检索服务。 */
  const searches = new Set<string>();
  /** 只记录成功列取的页，最终回答按相同范围重新读取文件元数据。 */
  const fileListOffsets = new Set<number>();

  return {
    snapshotId,
    retrievalTuning: options.retrievalTuning,
    /** @param offset 已成功查询的文件列表起点，不把列表条目授权为正文片段。 */
    recordFileList(offset: number) {
      fileListOffsets.add(offset);
    },
    /** 返回已查询分页的副本，重复请求同一页不会增加证据范围。 */
    getFileListOffsets() {
      return [...fileListOffsets];
    },
    /** 同步占用预算，阻止同一步并行工具突破上限；受控退出不冒充服务异常。 */
    beginToolCall() {
      if (toolCallCount >= MAX_AGENT_TOOL_CALLS)
        return false;
      toolCallCount += 1;
      return true;
    },
    /** @param key 搜索问题或带 related: 前缀的关联来源 ID。 */
    beginSearch(key: string) {
      const normalized = key.trim().replace(/\s+/g, " ").toLowerCase();
      if (searches.has(normalized)) return "duplicate-search" as const;
      if (searches.size >= MAX_AGENT_SEARCH_CALLS) return "search-budget-exhausted" as const;
      searches.add(normalized);
      return null;
    },
    /** 在模型步骤之间退出工具循环。 */
    isToolBudgetExhausted() {
      return toolCallCount >= MAX_AGENT_TOOL_CALLS;
    },
    /** 返回已实际登记的搜索次数，供步骤门禁判断能否结束证据收集。 */
    getSearchCount() {
      return searches.size;
    },
    /** 步骤门禁隐藏预算已用尽的搜索工具。 */
    canSearch() {
      return searches.size < MAX_AGENT_SEARCH_CALLS;
    },
    /** 搜索工具返回的 Chunk 才能进入后续读取或关联工具。 */
    permitChunks(chunkIds: string[]) {
      for (const chunkId of chunkIds) permittedChunkIds.add(chunkId);
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
    /** 读取成功后才进入最终回答的引用集合。 */
    addCitation(citation: Omit<SourceCitation, "id">) {
      if (citations.has(citation.chunkId)) return citations.get(citation.chunkId)!;
      const completed = { ...citation, id: citations.size + 1 };
      citations.set(completed.chunkId, completed);
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
    recordRetrievalTrace(trace: RetrievalTrace) {
      return options.onRetrievalTrace(trace);
    },
  };
}

export type VaultRunState = ReturnType<typeof createVaultRunState>;
