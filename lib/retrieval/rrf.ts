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
 * RRF 分数 = 1 / (rankConstant + 排名)
 * 如果一个 Chunk 同时出现在关键词结果和向量结果中，就把两边的分数相加
 * 最终 RRF 分数 = 关键词分数 + 向量分数
 * 
 * 例如：
 * Chunk A：关键词排名第 1 ， 向量排名第 5
 * Chunk B：关键词排名第 2 ， 没有出现在向量结果
 * Chunk C：没有出现在关键词结果 ， 向量排名第 1
 * 
 * 那么计算结果就是
 * A = 1 / (60 + 1) + 1 / (60 + 5) = 1/61 + 1/65 ≈ 0.03178
 * B = 1 / (60 + 2) = 1/62 ≈ 0.01613
 * C = 1 / (60 + 1) = 1/61 ≈ 0.01639
 * A > C > B
 * Chunk A 因为两种检索都认为它重要，所以排名明显更高 这就是 RRF 的核心思想，不直接比较关键词分数和向量相似度，而是比较它们各自的排名
 * 因为关键词得分是整数，相似度是小数，排名可以放在同一个尺度上
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
