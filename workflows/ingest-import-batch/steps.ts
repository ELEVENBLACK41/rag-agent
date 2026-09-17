/**
 * 修改时间：2026-09-16
 * 文件说明：VaultAgent 导入批次的解析、视觉资产、Embedding 与发布步骤。
 *
 * 每个步骤只传递导入标识；正文、文件字节和模型上下文均在业务边界内读取，
 * 既方便 Workflow 重放，也避免把私人内容放入持久化工作流状态。
 *
 * edit by：Sliye
 */

import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { embedMany, gateway } from "ai";
import { FatalError } from "workflow";
import { getDatabase } from "@/lib/db/client";
import { chunks, fileVersions, imports } from "@/lib/db/schema";
import { parseIndexableDocument } from "@/lib/ingestion/formats/registry";
import { getErrorMessage } from "@/lib/ingestion/errors";
import {
  getBatchIndexableImports,
  markBatchFailed,
  markImportFailed,
  markImportBatchRunning,
  markImportReady,
  publishImportBatch as publishBatch,
  updateImportBatchProgress,
} from "@/lib/ingestion/imports";
import type { ImportProgressStage } from "@/lib/ingestion/imports";
import { replaceImportDiagnostics } from "@/lib/ingestion/import-diagnostics";
import { analyzeInheritedMarkdownVisualImages } from "@/lib/ingestion/visual/markdown-image-analysis";
import { analyzeImportVisualAssets } from "@/lib/ingestion/visual/registry";
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

/** 查询当前批次中已注册解析器的可索引文件。 */
export async function listBatchIndexableImports(batchId: string) {
  "use step";
  return getBatchIndexableImports(batchId);
}

/**
 * 读取一个可索引文件、交由格式注册表解析，并幂等保存统一 Chunk。
 *
 * @param importId 文件导入记录标识。
 * @param progress 解析完成后要写入的批次进度；旧 Workflow 重放时可以省略。
 */
export async function parseAndStoreChunks(
  importId: string,
  progress?: { batchId: string; endPercent: number },
) {
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

  let parsedDocument;
  try {
    parsedDocument = await parseIndexableDocument(
      importRecord.mediaType,
      await readStoredFile(importRecord.storageKey),
    );
  } catch (error) {
    const message = getErrorMessage(
      error,
      "The uploaded file cannot be parsed or read.",
    );
    console.error("[ingestion:parse] document parsing failed", {
      importId,
      mediaType: importRecord.mediaType,
      error: message,
    });
    throw new FatalError(
      message,
    );
  }
  await replaceImportDiagnostics(importId, parsedDocument.diagnostics);
  const parsedChunks = parsedDocument.chunks;
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
  if (progress) {
    await updateImportBatchProgress(
      progress.batchId,
      progress.endPercent,
      "visualizing",
    );
  }
}

/**
 * 按受限批次为已存文档块生成向量，原文不会进入 Workflow 状态。
 *
 * @param importId 文件导入记录标识。
 * @param progress 每批 Chunk 完成后要写入的整体进度区间。
 */
export async function embedStoredChunks(
  importId: string,
  progress?: {
    batchId: string;
    startPercent: number;
    endPercent: number;
  },
) {
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
    if (progress) {
      const completedChunks = Math.min(
        index + batch.length,
        pendingChunks.length,
      );
      const ratio = completedChunks / pendingChunks.length;
      await updateImportBatchProgress(
        progress.batchId,
        progress.startPercent +
          (progress.endPercent - progress.startPercent) * ratio,
        "embedding",
      );
    }
  }
  if (progress && !pendingChunks.length) {
    await updateImportBatchProgress(
      progress.batchId,
      progress.endPercent,
      "embedding",
    );
  }
  return pendingChunks.length;
}

/**
 * 将完成解析和向量化的可索引文件标记为候选快照就绪。
 *
 * @param importId 文件导入记录标识。
 * @param progress 文件完成后的批次进度及下一阶段。
 */
export async function markIndexableImportReady(
  importId: string,
  progress?: {
    batchId: string;
    endPercent: number;
    nextStage: ImportProgressStage;
  },
) {
  "use step";
  await markImportReady(importId);
  if (progress) {
    await updateImportBatchProgress(
      progress.batchId,
      progress.endPercent,
      progress.nextStage,
    );
  }
}

/**
 * 对当前可索引文件的受限视觉候选执行分析，格式模块自行决定是否有候选。
 *
 * @param importId 文件导入记录标识。
 * @param mediaType 已校验的文件媒体类型。
 * @param progress 视觉步骤完成后要写入的批次进度。
 */
export async function analyzeIndexableImportVisualAssets(
  importId: string,
  mediaType: string,
  progress?: { batchId: string; endPercent: number },
) {
  "use step";
  const result = await analyzeImportVisualAssets(importId, mediaType);
  if (progress) {
    await updateImportBatchProgress(
      progress.batchId,
      progress.endPercent,
      "embedding",
    );
  }
  return result;
}

/**
 * 图片附件独立更新时，为候选快照继承的 Markdown 生成对应的新视觉 Chunk。
 * 返回需要补做 Embedding 的 Markdown 导入标识。
 */
export async function analyzeInheritedMarkdownAssets(batchId: string) {
  "use step";
  await updateImportBatchProgress(batchId, 90, "visualizing");
  const importIds = await analyzeInheritedMarkdownVisualImages(batchId);
  await updateImportBatchProgress(batchId, 95, "embedding");
  return importIds;
}

/** 记录一个文件的具体失败，以便批次状态接口保留真实失败来源。 */
export async function failIndexableImport(importId: string, message: string) {
  "use step";
  await markImportFailed(importId, message);
}

/** 以一个事务发布候选快照。 */
export async function publishImportBatch(batchId: string) {
  "use step";
  await updateImportBatchProgress(batchId, 99, "finalizing");
  await publishBatch(batchId);
}

/** 记录候选批次失败，不改变当前已经发布的快照。 */
export async function failImportBatch(batchId: string, message: string) {
  "use step";
  await markBatchFailed(batchId, message);
}
