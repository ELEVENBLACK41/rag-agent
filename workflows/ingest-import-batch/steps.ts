/**
 * 修改时间：2026-09-10 | 文件说明：VaultAgent 导入批次解析、Embedding 与发布步骤 | edit by：Sliye
 */

import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { embedMany, gateway } from "ai";
import { FatalError } from "workflow";
import { getDatabase } from "@/lib/db/client";
import { chunks, fileVersions, imports } from "@/lib/db/schema";
import { parseIndexableText } from "@/lib/ingestion/formats/registry";
import {
  getBatchTextImports,
  markBatchFailed,
  markImportBatchRunning,
  markImportReady,
  publishImportBatch as publishBatch,
} from "@/lib/ingestion/imports";
import { readStoredFile } from "@/lib/storage/files";

/** 经过 DAY1 验证的 Gateway 向量模型。 */
const EMBEDDING_MODEL = "alibaba/qwen3-embedding-0.6b";
/** 数据库 pgvector 列与 Gateway 模型约定的向量维度。 */
const EMBEDDING_DIMENSIONS = 1_024;
/** 单次 Gateway 向量请求的最大文本块数量，限制单次费用与载荷。 */
const EMBEDDING_BATCH_SIZE = 50;
/** 单个文件允许建立的最大文本块数量。 */
const MAX_CHUNKS_PER_FILE = 500;

/** 更新导入批次及待处理文件为运行状态。 */
export async function startBatchImport(batchId: string) {
  "use step";
  await markImportBatchRunning(batchId);
}

/** 查询当前批次中已注册文本解析器的文件。 */
export async function listBatchTextImports(batchId: string) {
  "use step";
  return getBatchTextImports(batchId);
}

/**
 * 读取一个文本文件、交由格式注册表解析，并幂等保存统一 Chunk。
 *
 * @param importId 文件导入记录标识。
 */
export async function parseAndStoreChunks(importId: string) {
  "use step";

  const db = getDatabase();
  const [importRecord] = await db
    .select({
      fileVersionId: imports.fileVersionId,
      snapshotId: imports.snapshotId,
      storageKey: fileVersions.storageKey,
      mediaType: fileVersions.mediaType,
    })
    .from(imports)
    .innerJoin(fileVersions, eq(imports.fileVersionId, fileVersions.id))
    .where(eq(imports.id, importId))
    .limit(1);
  if (!importRecord) throw new FatalError("Import record does not exist.");

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      await readStoredFile(importRecord.storageKey),
    );
  } catch {
    throw new FatalError(
      "The uploaded text file is not valid UTF-8 or cannot be read.",
    );
  }
  const parsedChunks = parseIndexableText(importRecord.mediaType, text);
  if (!parsedChunks.length)
    throw new FatalError("The uploaded file does not contain indexable text.");
  if (parsedChunks.length > MAX_CHUNKS_PER_FILE)
    throw new FatalError(
      `File exceeds the ${MAX_CHUNKS_PER_FILE} chunk import limit.`,
    );

  await db
    .insert(chunks)
    .values(
      parsedChunks.map((chunk, ordinal) => ({
        id: randomUUID(),
        fileVersionId: importRecord.fileVersionId,
        snapshotId: importRecord.snapshotId,
        ordinal,
        content: chunk.content,
        contentHash: createHash("sha256").update(chunk.content).digest("hex"),
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        sourceLocator: chunk.sourceLocator,
      })),
    )
    .onConflictDoNothing();
}

/**
 * 按受限批次为已存文本块生成向量，原文不会进入 Workflow 状态。
 *
 * @param importId 文件导入记录标识。
 */
export async function embedStoredChunks(importId: string) {
  "use step";

  if (!process.env.AI_GATEWAY_API_KEY)
    throw new FatalError(
      "AI_GATEWAY_API_KEY is required before indexing text files.",
    );
  const db = getDatabase();
  const [importRecord] = await db
    .select({ fileVersionId: imports.fileVersionId })
    .from(imports)
    .where(eq(imports.id, importId))
    .limit(1);
  if (!importRecord) throw new FatalError("Import record does not exist.");

  const pendingChunks = await db
    .select({ id: chunks.id, content: chunks.content })
    .from(chunks)
    .where(
      and(
        eq(chunks.fileVersionId, importRecord.fileVersionId),
        isNull(chunks.embedding),
      ),
    )
    .orderBy(chunks.ordinal);

  for (
    let index = 0;
    index < pendingChunks.length;
    index += EMBEDDING_BATCH_SIZE
  ) {
    const batch = pendingChunks.slice(index, index + EMBEDDING_BATCH_SIZE);
    const result = await embedMany({
      model: gateway.embeddingModel(EMBEDDING_MODEL),
      values: batch.map((chunk) => chunk.content),
    });
    if (
      result.embeddings.some(
        (embedding) => embedding.length !== EMBEDDING_DIMENSIONS,
      )
    ) {
      throw new FatalError(
        "Gateway returned an embedding with an unexpected dimension.",
      );
    }
    await Promise.all(
      batch.map((chunk, batchIndex) =>
        db
          .update(chunks)
          .set({ embedding: result.embeddings[batchIndex] })
          .where(eq(chunks.id, chunk.id)),
      ),
    );
  }
  return pendingChunks.length;
}

/** 将完成解析和向量化的文本文件标记为候选快照就绪。 */
export async function markTextImportReady(importId: string) {
  "use step";
  await markImportReady(importId);
}

/** 以一个事务发布候选快照。 */
export async function publishImportBatch(batchId: string) {
  "use step";
  await publishBatch(batchId);
}

/** 记录候选批次失败，不改变当前已经发布的快照。 */
export async function failImportBatch(batchId: string, message: string) {
  "use step";
  await markBatchFailed(batchId, message);
}
