/**
 * 修改时间：2026-09-07 | 文件说明：VaultAgent D3 已发布 Markdown 快照向量检索 | edit by：Sliye
 */

import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { cosineDistance } from "drizzle-orm/sql/functions/vector";
import { embed, gateway } from "ai";
import { getDatabase } from "@/lib/db/client";
import { chunks, fileVersions, indexSnapshots, logicalFiles } from "@/lib/db/schema";

/** DAY1 已验证的 Gateway 向量模型。 */
const EMBEDDING_MODEL = "alibaba/qwen3-embedding-0.6b";
/** D2 数据库列与模型约定的向量维度。 */
const EMBEDDING_DIMENSIONS = 1_024;
/** D3 单文件问答送入模型的最多候选片段数。 */
const RETRIEVAL_LIMIT = 6;

export type RetrievedChunk = {
  chunkId: string;
  content: string;
  displayName: string;
  startLine: number;
  endLine: number;
  similarity: number;
};

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
 * 为问题生成向量，并从固定快照内返回余弦距离最近的文本块。
 * 官方文档：https://ai-sdk.dev/docs/ai-sdk-core/embeddings
 *
 * @param snapshotId 已发布且固定的索引快照标识。
 * @param question 用户提交的问题，最多 4,000 个字符。
 */
export async function retrievePublishedChunks(snapshotId: string, question: string) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error("AI_GATEWAY_API_KEY is required before querying the knowledge base.");
  }

  const { embedding } = await embed({
    model: gateway.embeddingModel(EMBEDDING_MODEL),
    value: question,
  });
  if (
    embedding.length !== EMBEDDING_DIMENSIONS ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("Gateway returned an invalid query embedding.");
  }

  const distance = cosineDistance(chunks.embedding, embedding);
  const rows = await getDatabase()
    .select({
      chunkId: chunks.id,
      content: chunks.content,
      displayName: logicalFiles.displayName,
      startLine: chunks.startLine,
      endLine: chunks.endLine,
      similarity: sql<number>`1 - (${distance})`,
    })
    .from(chunks)
    .innerJoin(fileVersions, eq(chunks.fileVersionId, fileVersions.id))
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .where(
      and(
        eq(chunks.snapshotId, snapshotId),
        isNotNull(chunks.embedding),
        eq(fileVersions.status, "indexed"),
        isNull(logicalFiles.deletedAt),
      ),
    )
    .orderBy(distance)
    .limit(RETRIEVAL_LIMIT);

  return rows.map((row) => ({ ...row, similarity: Number(row.similarity) }));
}
