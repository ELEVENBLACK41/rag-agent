/**
 * 修改时间：2026-09-13
 * 文件说明：VaultAgent DAY8 混合检索参数与模型配置。
 *
 * 所有会影响候选池、融合和重排序的参数集中在这里，确保检索 Trace、评测报告
 * 与后续调参使用相同名称和口径。
 *
 * edit by：Sliye
 */

/** Gateway 中已在 DAY1 验证并固定的查询向量模型。 */
export const EMBEDDING_MODEL = "alibaba/qwen3-embedding-0.6b";
/** pgvector 列与 Embedding 模型约定的向量维度。 */
export const EMBEDDING_DIMENSIONS = 1_024;
/** Gateway 中计划锁定的轻量多语言重排序模型。 */
export const RERANK_MODEL = "voyage/rerank-2.5-lite";

/** 中文关键词与向量检索各自保留的初始候选数量。 */
export const RETRIEVAL_CANDIDATE_LIMIT = 12;
/** RRF 融合后允许送入 rerank 的最多候选数。 */
export const RERANK_CANDIDATE_LIMIT = 12;
/** 最终提供给问答模型和引用的最多证据片段数。 */
export const FINAL_RETRIEVAL_LIMIT = 6;
/** Reciprocal Rank Fusion 的平滑常数，避免头部排名独占全部分数。 */
export const RRF_RANK_CONSTANT = 60;
/** 单次 rerank 的最长等待时间，超过后直接保留 RRF 顺序。 */
export const RERANK_TIMEOUT_MS = 8_000;
