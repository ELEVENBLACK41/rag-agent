/**
 * 修改时间：2026-09-13
 * 文件说明：VaultAgent DAY8 跨格式检索结果与可审计 Trace 类型。
 *
 * edit by：Sliye
 */

import type { SourceLocator } from "@/lib/ingestion/formats/types";

/** 一个已发布快照内、可作为问答证据的文本块。 */
export type RetrievedChunk = {
  chunkId: string;
  content: string;
  displayName: string;
  startLine: number | null;
  endLine: number | null;
  sourceLocator: SourceLocator | null;
  /** 向量候选才有余弦相似度；仅关键词命中时为 null。 */
  similarity: number | null;
  keywordRank?: number;
  vectorRank?: number;
  fusionRank?: number;
  rerankScore?: number;
};

/** 重排序的实际结果，失败和跳过均保留明确原因。 */
export type RerankTrace =
  | {
      status: "completed";
      modelId: string;
      durationMs: number;
      inputChunkIds: string[];
      outputChunkIds: string[];
    }
  | {
      status: "fallback";
      modelId: string;
      durationMs: number;
      inputChunkIds: string[];
      reason: string;
    };

/** DAY8 每次检索的脱敏排序记录；只保存 Chunk ID 与配置，不复制私人正文。 */
export type RetrievalTrace = {
  version: "day8-hybrid-v1";
  keywordTerms: string[];
  keywordCandidateIds: string[];
  vectorCandidateIds: string[];
  fusedCandidateIds: string[];
  finalChunkIds: string[];
  config: {
    keywordCandidateLimit: number;
    vectorCandidateLimit: number;
    rerankCandidateLimit: number;
    finalLimit: number;
    rrfRankConstant: number;
    rerankTimeoutMs: number;
  };
  vectorStatus: "completed" | "fallback";
  vectorFallbackReason?: string;
  rerank: RerankTrace;
};

/** 检索调用的最终证据片段及其排序 Trace。 */
export type RetrievalResult = {
  chunks: RetrievedChunk[];
  trace: RetrievalTrace;
};
