/**
 * 修改时间：2026-09-11 | 文件说明：VaultAgent 已发布快照向量检索 | edit by：Sliye
 */

import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { cosineDistance } from "drizzle-orm/sql/functions/vector";
import { embed, gateway } from "ai";
import { getDatabase } from "@/lib/db/client";
import { chunks, fileVersions, indexSnapshotFiles, indexSnapshots, logicalFiles } from "@/lib/db/schema";
import {
  toSourceLocator,
  type SourceLocator,
} from "@/lib/ingestion/formats/types";

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
  startLine: number | null;
  endLine: number | null;
  sourceLocator: SourceLocator | null;
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

  // 检测有没有配置 AI_GATEWAY_API_KEY
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error("AI_GATEWAY_API_KEY is required before querying the knowledge base.");
  }

  const { embedding } = await embed({
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
  const distance = cosineDistance(chunks.embedding, embedding);//这个是距离

  //构造函数，并置顶返回哪些字段
  const rows = await getDatabase()
    .select({
      chunkId: chunks.id, //文本块 ID
      content: chunks.content, //文本块正文，这部分最终会作为上下文传给大模型
      displayName: logicalFiles.displayName,//原始文件名
      startLine: chunks.startLine,//记录文本块在原文件中的行号范围
      endLine: chunks.endLine,
      sourceLocator: chunks.sourceLocator,
      similarity: sql<number>`1 - (${distance})`, //相似度 = 1 - 余弦距离
    })
    .from(chunks) //查询的主表是 chunks
    .innerJoin(fileVersions, eq(chunks.fileVersionId, fileVersions.id)) //连接文件版本表
    .innerJoin(indexSnapshotFiles, eq(indexSnapshotFiles.fileVersionId, fileVersions.id))
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))//连接逻辑文件表
    .where(
      and(
        eq(indexSnapshotFiles.snapshotId, snapshotId),
        isNotNull(chunks.embedding),
        eq(fileVersions.status, "indexed"),
        isNull(logicalFiles.deletedAt),
      ),
    )
    .orderBy(distance)//按距离升序排列，距离越小，相似度越高
    .limit(RETRIEVAL_LIMIT); //前六个

  return rows.map((row) => ({
    ...row,
    similarity: Number(row.similarity),
    sourceLocator: toSourceLocator(row.sourceLocator),
  }));
}
