/**
 * 修改时间：2026-09-13
 * 文件说明：VaultAgent Reciprocal Rank Fusion 融合规则。
 *
 * 此模块只处理内存中的排名，数据库查询与模型调用保持在 search.ts，方便后续以
 * 评测数据独立验证融合参数。
 *
 * edit by：Sliye
 */

/** 参与融合的候选项必须拥有稳定 Chunk ID。 */
export type RankedCandidate<T extends { chunkId: string }> = T & {
  keywordRank?: number;
  vectorRank?: number;
  rrfScore?: number;
};

/**
 * 按 RRF 合并两条候选列表，并保留各来源排名以便记录 Trace。
 *
 * @param keywordCandidates 中文关键词检索结果，按关键词得分降序。
 * @param vectorCandidates 向量检索结果，按余弦相似度降序。
 * @param rankConstant RRF 平滑常数，必须为正整数。
 */
export function fuseWithRrf<T extends { chunkId: string }>(
  keywordCandidates: T[],
  vectorCandidates: T[],
  rankConstant: number,
): Array<RankedCandidate<T>> {
  const candidates = new Map<string, RankedCandidate<T>>();

  const register = (candidate: T, rank: number, source: "keyword" | "vector") => {
    const current: RankedCandidate<T> = candidates.get(candidate.chunkId) ?? {
      ...candidate,
      rrfScore: 0,
    };
    if (source === "keyword") current.keywordRank = rank;
    else current.vectorRank = rank;
    current.rrfScore = (current.rrfScore ?? 0) + 1 / (rankConstant + rank);
    candidates.set(candidate.chunkId, current);
  };

  keywordCandidates.forEach((candidate, index) => register(candidate, index + 1, "keyword"));
  vectorCandidates.forEach((candidate, index) => register(candidate, index + 1, "vector"));

  return [...candidates.values()].sort(
    (left, right) =>
      (right.rrfScore ?? 0) - (left.rrfScore ?? 0) ||
      left.chunkId.localeCompare(right.chunkId),
  );
}
