/**
 * 修改时间：2026-09-16
 * 文件说明：VaultAgent DAY8 已发布快照的混合检索与重排序。
 *
 * 本模块只读取固定快照：关键词、向量、RRF 与 rerank 的每一步都返回不含正文的
 * 排序 Trace。rerank 或向量服务失败时回退到仍然可用的候选，不将降级标记为成功。
 *
 * AI SDK rerank 文档：https://ai-sdk.dev/docs/ai-sdk-core/reranking
 *
 * edit by：Sliye
 */

import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { cosineDistance } from "drizzle-orm/sql/functions/vector";
import { embed, gateway, rerank } from "ai";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  FINAL_RETRIEVAL_LIMIT,
  RERANK_CANDIDATE_LIMIT,
  RERANK_MODEL,
  RERANK_TIMEOUT_MS,
  RETRIEVAL_CANDIDATE_LIMIT,
  RRF_RANK_CONSTANT,
} from "@/lib/retrieval/config";
import { getDatabase } from "@/lib/db/client";
import {
  chunks,
  fileVersions,
  indexSnapshotFiles,
  indexSnapshots,
  logicalFiles,
} from "@/lib/db/schema";
import { toSourceLocator } from "@/lib/ingestion/formats/types";
import { extractKeywordTerms } from "@/lib/retrieval/keywords";
import { fuseWithRrf } from "@/lib/retrieval/rrf";
import type {
  RerankTrace,
  RetrievedChunk,
  RetrievalResult,
  RetrievalTrace,
} from "@/lib/retrieval/types";

export type { RetrievedChunk, RetrievalResult, RetrievalTrace } from "@/lib/retrieval/types";

type VectorCandidateResult =
  | { status: "completed"; candidates: RetrievedChunk[] }
  | { status: "fallback"; reason: string; candidates: RetrievedChunk[] };

type RerankExecution = { chunks: RetrievedChunk[]; trace: RerankTrace };

/**
 * 获取当前工作区最后一个可供检索的已发布索引快照。
 *
 * @param workspaceId 工作区标识。
 */
export async function getLatestPublishedSnapshot(workspaceId: string) {
  const [snapshot] = await getDatabase()
    .select({ id: indexSnapshots.id })
    .from(indexSnapshots)
    .where(
      and(
        eq(indexSnapshots.workspaceId, workspaceId),
        eq(indexSnapshots.status, "published"),
      ),
    )
    .orderBy(desc(indexSnapshots.publishedAt))
    .limit(1);

  return snapshot ?? null;
}

/**
 * 为 D3 兼容调用返回最终证据片段；新的调用方应使用带 Trace 的函数。
 *
 * @param snapshotId 已发布且固定的索引快照标识。
 * @param question 用户提交的问题。
 */
export async function retrievePublishedChunks(snapshotId: string, question: string) {
  //关键词候选和向量候选
  const result = await retrievePublishedChunksWithTrace(snapshotId, question);
  return result.chunks;
}

/**
 * 在固定快照中执行关键词、向量、RRF 与可降级 rerank。
 *
 * 关键词路径不依赖 AI Gateway，因此向量或 rerank 服务异常时仍可返回可审计的
 * 关键词/RRF 结果。若两条候选路径均为空，调用方才将其视为无资料可答。
 *
 * @param snapshotId 已发布且固定的索引快照标识。
 * @param question 已在 API 边界完成长度校验的用户问题。
 * @param abortSignal 调用方取消信号；取消不作为检索降级继续执行。
 */
export async function retrievePublishedChunksWithTrace(
  snapshotId: string,
  question: string,
  abortSignal?: AbortSignal,
): Promise<RetrievalResult> {
  //从keyword提取出来的关键词keywordTerms
  const keywordTerms = extractKeywordTerms(question);
  const activeFileVersionIds = await getActiveSnapshotFileVersionIds(snapshotId);
  const [keywordCandidates, vectorResult] = await Promise.all([
    //关键词候选
    retrieveKeywordCandidates(snapshotId, keywordTerms, activeFileVersionIds),
    //向量候选
    retrieveVectorCandidates(snapshotId, question, activeFileVersionIds, abortSignal),
  ]);
  const fusedCandidates = fuseWithRrf<RetrievedChunk>(
    keywordCandidates,
    vectorResult.candidates,
    RRF_RANK_CONSTANT,
  )
    .slice(0, RERANK_CANDIDATE_LIMIT)
    .map((candidate, index) => ({ ...candidate, fusionRank: index + 1 }));
  const reranked = await rerankCandidates(question, fusedCandidates, abortSignal);

  const trace: RetrievalTrace = {
    version: "day8-hybrid-v2-latest-file",
    keywordTerms,
    keywordCandidateIds: keywordCandidates.map((candidate) => candidate.chunkId),
    vectorCandidateIds: vectorResult.candidates.map((candidate) => candidate.chunkId),
    fusedCandidateIds: fusedCandidates.map((candidate) => candidate.chunkId),
    finalChunkIds: reranked.chunks.map((candidate) => candidate.chunkId),
    config: {
      keywordCandidateLimit: RETRIEVAL_CANDIDATE_LIMIT,
      vectorCandidateLimit: RETRIEVAL_CANDIDATE_LIMIT,
      rerankCandidateLimit: RERANK_CANDIDATE_LIMIT,
      finalLimit: FINAL_RETRIEVAL_LIMIT,
      rrfRankConstant: RRF_RANK_CONSTANT,
      rerankTimeoutMs: RERANK_TIMEOUT_MS,
    },
    vectorStatus: vectorResult.status,
    ...(vectorResult.status === "fallback"
      ? { vectorFallbackReason: vectorResult.reason }
      : {}),
    rerank: reranked.trace,
  };

  return { chunks: reranked.chunks, trace };
}

/** 使用中文双字词/短语和拉丁关键词检索候选。 */
async function retrieveKeywordCandidates(
  snapshotId: string,
  terms: string[],
  activeFileVersionIds: string[],
): Promise<RetrievedChunk[]> {
  if (!terms.length || !activeFileVersionIds.length) return [];

  const matchExpressions = terms.map(
    (term) =>
      sql<number>`CASE WHEN POSITION(${term} IN LOWER(${chunks.content})) > 0 THEN 1 ELSE 0 END`,
  );
  const keywordScore = sql<number>`(${sql.join(matchExpressions, sql` + `)})`;
  const matchesAnyTerm = or(
    ...terms.map(
      (term) => sql`POSITION(${term} IN LOWER(${chunks.content})) > 0`,
    ),
  );
  if (!matchesAnyTerm) return [];

  const rows = await getDatabase()
    .select({
      chunkId: chunks.id,
      content: chunks.content,
      displayName: logicalFiles.displayName,
      startLine: chunks.startLine,
      endLine: chunks.endLine,
      sourceLocator: chunks.sourceLocator,
      keywordScore,
    })
    .from(chunks)
    .innerJoin(fileVersions, eq(chunks.fileVersionId, fileVersions.id))
    .innerJoin(indexSnapshotFiles, eq(indexSnapshotFiles.fileVersionId, fileVersions.id))
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .where(publishedChunkScope(snapshotId, activeFileVersionIds, matchesAnyTerm))
    .orderBy(desc(keywordScore), chunks.id)
    .limit(RETRIEVAL_CANDIDATE_LIMIT);

  return rows.map((row) => ({ ...toRetrievedChunk(row), similarity: null }));
}

/** 生成查询向量并检索语义相近的候选；失败时让关键词路径独立完成。 */
async function retrieveVectorCandidates(
  snapshotId: string,
  question: string,
  activeFileVersionIds: string[],
  abortSignal?: AbortSignal,
): Promise<VectorCandidateResult> {
  try {
    if (!activeFileVersionIds.length) {
      return { status: "completed", candidates: [] };
    }
    if (!process.env.AI_GATEWAY_API_KEY) {
      throw new Error("AI_GATEWAY_API_KEY is required before vector retrieval.");
    }
    // 官方：https://ai-sdk.dev/docs/reference/ai-sdk-core/embed；取消传播到查询向量请求。
    abortSignal?.throwIfAborted();
    const { embedding } = await embed({
      abortSignal,
      model: gateway.embeddingModel(EMBEDDING_MODEL), // 使用 Gateway Embedding 模型
      value: question, // 用户问题文本,用户的问题文本只向量化一次，所以不会用到embedMany
    });
    if (
      embedding.length !== EMBEDDING_DIMENSIONS ||
      embedding.some((value) => !Number.isFinite(value))
    ) {
      throw new Error("Gateway returned an invalid query embedding.");
    }
  /**
   * 计算查询向量与数据库中存储的向量的余弦距离，并返回最相似的文本块
   * @param chunks.embedding 是数据库中存储的向量
   * @param embedding 是用户问题生成的向量
   * chunks.embedding <=> $1 是Drizzle对pgvector的封装，$1 就是用户问题的向量
   * 余弦据的特点就是距离越小，越相似，距离越大越不相似
   */
    const distance = cosineDistance(chunks.embedding, embedding);
    //构造函数，并置顶返回哪些字段
    const rows = await getDatabase()
      .select({
        chunkId: chunks.id,//文本块 ID
        content: chunks.content,//文本块正文，这部分最终会作为上下文传给大模型
        displayName: logicalFiles.displayName,//原始文件名
        startLine: chunks.startLine,//记录文本块在原文件中的行号范围
        endLine: chunks.endLine,
        sourceLocator: chunks.sourceLocator,
        similarity:sql<number>`1 - (${distance})`, //相似度 = 1 - 余弦距离
      })
      .from(chunks) //查询的主表是 chunks
      .innerJoin(fileVersions, eq(chunks.fileVersionId, fileVersions.id)) //连接文件版本表
      .innerJoin(indexSnapshotFiles, eq(indexSnapshotFiles.fileVersionId, fileVersions.id))
      .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id)) //连接逻辑文件表
      .where(publishedChunkScope(snapshotId, activeFileVersionIds, isNotNull(chunks.embedding)))
      .orderBy(distance) //按距离升序排列，距离越小，相似度越高
      .limit(RETRIEVAL_CANDIDATE_LIMIT);
    return {
      status: "completed" as const,
      candidates: rows.map((row) => ({
        ...toRetrievedChunk(row),
        similarity: Number(row.similarity),
      })),
    };
  } catch (error) {
    abortSignal?.throwIfAborted();
    return {
      status: "fallback" as const,
      reason: getSafeRetrievalError(error),
      candidates: [],
    };
  }
}

/** 只把 RRF 的有限候选交给 Gateway rerank；异常、限流或超时均回退原顺序。 */
async function rerankCandidates(
  question: string,
  candidates: RetrievedChunk[],
  abortSignal?: AbortSignal,
): Promise<RerankExecution> {
  abortSignal?.throwIfAborted();
  const inputChunkIds = candidates.map((candidate) => candidate.chunkId);
  if (!candidates.length) {
    return {
      chunks: [],
      trace: {
        status: "fallback" as const,
        modelId: RERANK_MODEL,
        durationMs: 0,
        inputChunkIds,
        reason: "没有可重排序的融合候选。",
      },
    };
  }
  if (!process.env.AI_GATEWAY_API_KEY) {
    return fallbackToFusion(candidates, inputChunkIds, 0, "未配置 AI_GATEWAY_API_KEY。");
  }

  const startedAt = Date.now();
  try {
    //rerank排序
    const result = await rerank({
      model: gateway.rerankingModel(RERANK_MODEL),
      documents: candidates.map((candidate) => candidate.content),//候选 Chunk 正文
      query: question,//用户问题
      topN: FINAL_RETRIEVAL_LIMIT,
      maxRetries: 0,
      abortSignal: abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(RERANK_TIMEOUT_MS)]) : AbortSignal.timeout(RERANK_TIMEOUT_MS),
    });
    const rerankedChunks: RetrievedChunk[] = [];
    for (const ranking of result.ranking) {
      const candidate = candidates[ranking.originalIndex];
      if (candidate) rerankedChunks.push({ ...candidate, rerankScore: ranking.score });
    }
    if (!rerankedChunks.length) {
      return fallbackToFusion(
        candidates,
        inputChunkIds,
        Date.now() - startedAt,
        "rerank 未返回有效排序。",
      );
    }
    return {
      chunks: rerankedChunks,
      trace: {
        status: "completed" as const,
        modelId: RERANK_MODEL,
        durationMs: Date.now() - startedAt,
        inputChunkIds,
        outputChunkIds: rerankedChunks.map((candidate) => candidate.chunkId),
      },
    };
  } catch (error) {
    abortSignal?.throwIfAborted();
    return fallbackToFusion(
      candidates,
      inputChunkIds,
      Date.now() - startedAt,
      getSafeRetrievalError(error),
    );
  }
}

/** 将 RRF 前列直接作为最终证据，明确记录这不是 rerank 成功。 */
function fallbackToFusion(
  candidates: RetrievedChunk[],
  inputChunkIds: string[],
  durationMs: number,
  reason: string,
): RerankExecution {
  return {
    chunks: candidates.slice(0, FINAL_RETRIEVAL_LIMIT),
    trace: {
      status: "fallback" as const,
      modelId: RERANK_MODEL,
      durationMs,
      inputChunkIds,
      reason,
    },
  };
}

/**
 * 统一固定快照成员、文件状态与删除过滤。
 * Chunk 的 snapshotId 是它首次解析时的候选快照，不代表后续继承它的快照成员关系。
 */
function publishedChunkScope(
  snapshotId: string,
  activeFileVersionIds: string[],
  extraWhere: ReturnType<typeof sql>,
) {
  return and(
    eq(indexSnapshotFiles.snapshotId, snapshotId),
    inArray(fileVersions.id, activeFileVersionIds),
    eq(fileVersions.status, "indexed"),
    isNull(logicalFiles.deletedAt),
    sql`(
      coalesce(${chunks.sourceLocator}->>'format', '') <> 'markdown-visual'
      or exists (
        select 1
        from index_snapshot_files as markdown_image_files
        inner join file_versions as markdown_image_versions
          on markdown_image_versions.id = markdown_image_files.file_version_id
        inner join logical_files as markdown_image_logical_files
          on markdown_image_logical_files.id = markdown_image_versions.logical_file_id
        where markdown_image_files.snapshot_id = ${snapshotId}
          and markdown_image_files.file_version_id = ${chunks.sourceLocator}->>'attachmentFileVersionId'
          and markdown_image_versions.status in ('stored', 'indexed')
          and markdown_image_logical_files.deleted_at is null
      )
    )`,
    extraWhere,
  );
}

/**
 * 在一个固定快照内按 Vault 相对路径选出最新写入版本。
 * 历史数据若因早期缺少唯一约束产生重复逻辑文件，也不会再同时进入检索。
 *
 * @param snapshotId 本次 Run 固定使用的已发布快照。
 */
async function getActiveSnapshotFileVersionIds(snapshotId: string) {
  const records = await getDatabase()
    .select({
      id: fileVersions.id,
      sourcePath: logicalFiles.sourcePath,
      displayName: logicalFiles.displayName,
    })
    .from(indexSnapshotFiles)
    .innerJoin(fileVersions, eq(indexSnapshotFiles.fileVersionId, fileVersions.id))
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .where(
      and(
        eq(indexSnapshotFiles.snapshotId, snapshotId),
        isNull(logicalFiles.deletedAt),
      ),
    )
    .orderBy(desc(fileVersions.createdAt), desc(fileVersions.id));
  const latestByPath = new Map<string, string>();

  for (const record of records) {
    // D3 旧数据没有 sourcePath，使用文件名与后续同名根目录文件对齐。
    const identity = record.sourcePath ?? record.displayName;
    if (!latestByPath.has(identity)) latestByPath.set(identity, record.id);
  }

  return [...latestByPath.values()];
}

/** 将数据库 JSON 定位字段恢复为跨格式的受限类型。 */
function toRetrievedChunk(row: {
  chunkId: string;
  content: string;
  displayName: string;
  startLine: number | null;
  endLine: number | null;
  sourceLocator: unknown;
}) {
  return {
    chunkId: row.chunkId,
    content: row.content,
    displayName: row.displayName,
    startLine: row.startLine,
    endLine: row.endLine,
    sourceLocator: toSourceLocator(row.sourceLocator),
  };
}

/** 避免把 Gateway 原始响应、密钥痕迹或内部堆栈写进可见检索 Trace。 */
function getSafeRetrievalError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 240);
  return "检索服务发生未知错误。";
}
