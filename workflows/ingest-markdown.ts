/**
 * 修改时间：2026-09-06 | 文件说明：VaultAgent D2 Markdown 持久化导入工作流 | edit by：Sliye
 */

import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { embedMany, gateway } from "ai";
import { FatalError } from "workflow";
import { getDatabase } from "@/lib/db/client";
import { chunks, fileVersions, imports, indexSnapshots } from "@/lib/db/schema";
import { chunkMarkdown } from "@/lib/ingestion/markdown";
import { readLocalFile } from "@/lib/storage/local";

/** 经过 DAY1 验证的 Gateway 向量模型。 */
const EMBEDDING_MODEL = "alibaba/qwen3-embedding-0.6b";
/** 数据库 pgvector 列与 Gateway 模型约定的向量维度。 */
const EMBEDDING_DIMENSIONS = 1_024;
/** 单次 Gateway 向量请求的最大文本块数量，限制单次费用与载荷。 */
const EMBEDDING_BATCH_SIZE = 50;
/** 单个导入允许建立的最大文本块数量，限制本地开发阶段的成本。 */
const MAX_CHUNKS_PER_IMPORT = 500;

/**
 * 编排可恢复步骤，Workflow 状态中仅传递导入标识。
 *
 * @param importId 导入任务标识。
 */
export async function ingestMarkdownWorkflow(importId: string) {
  "use workflow";

  try {
    await markImportRunning(importId);
    await parseAndStoreChunks(importId);
    const embeddedChunkCount = await embedStoredChunks(importId);
    await publishImport(importId);
    return { embeddedChunkCount };
  } catch (error) {
    const errorMessage =
      error instanceof FatalError
        ? error.message
        : "Markdown import failed. Check the server logs for details.";
    await markImportFailed(importId, errorMessage);
    throw error;
  }
}

/**
 * 在持久化工作开始前更新业务任务状态。
 *
 * @param importId 导入任务标识。
 */
async function markImportRunning(importId: string) {
  "use step";

  await getDatabase().update(imports).set({ status: "running", errorMessage: null }).where(eq(imports.id, importId));
}

/**
 * 读取原始 Markdown 并幂等写入标题感知的文本块。
 *
 * @param importId 导入任务标识。
 */
async function parseAndStoreChunks(importId: string) {
  "use step";

  const db = getDatabase();
  const [importRecord] = await db
    .select({
      fileVersionId: imports.fileVersionId,
      snapshotId: imports.snapshotId,
      storageKey: fileVersions.storageKey,
    })
    .from(imports)
    .innerJoin(fileVersions, eq(imports.fileVersionId, fileVersions.id))
    .where(eq(imports.id, importId))
    .limit(1);

  if (!importRecord) throw new FatalError("Import record does not exist.");

  let fileBytes: Uint8Array;
  try {
    fileBytes = await readLocalFile(importRecord.storageKey);
  } catch {
    throw new FatalError("The uploaded Markdown file cannot be read.");
  }

  let markdown: string;
  try {
    markdown = new TextDecoder("utf-8", { fatal: true }).decode(fileBytes);
  } catch {
    throw new FatalError("The uploaded file is not valid UTF-8 Markdown.");
  }

  const parsedChunks = chunkMarkdown(markdown);
  if (!parsedChunks.length) throw new FatalError("Markdown does not contain indexable text.");
  if (parsedChunks.length > MAX_CHUNKS_PER_IMPORT) {
    throw new FatalError(`Markdown exceeds the ${MAX_CHUNKS_PER_IMPORT} chunk import limit.`);
  }

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
      })),
    )
    .onConflictDoNothing();

  return parsedChunks.length;
}

/**
 * 按受限批次为已存文本块生成向量，文档正文不会进入 Workflow 状态。
 *
 * @param importId 导入任务标识。
 */
async function embedStoredChunks(importId: string) {
  "use step";

  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new FatalError("AI_GATEWAY_API_KEY is required before indexing Markdown.");
  }

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
    .where(and(eq(chunks.fileVersionId, importRecord.fileVersionId), isNull(chunks.embedding)))
    .orderBy(chunks.ordinal);

  for (let index = 0; index < pendingChunks.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = pendingChunks.slice(index, index + EMBEDDING_BATCH_SIZE);
    // https://ai-sdk.dev/docs/ai-sdk-core/embeddings
    const result = await embedMany({
      model: gateway.embeddingModel(EMBEDDING_MODEL),
      values: batch.map((chunk) => chunk.content),
    });

    if (result.embeddings.some((embedding) => embedding.length !== EMBEDDING_DIMENSIONS)) {
      throw new FatalError("Gateway returned an embedding with an unexpected dimension.");
    }

    await Promise.all(
      batch.map((chunk, batchIndex) =>
        db.update(chunks).set({ embedding: result.embeddings[batchIndex] }).where(eq(chunks.id, chunk.id)),
      ),
    );
  }

  return pendingChunks.length;
}

/**
 * 仅在向量全部写入后，以事务方式发布导入快照。
 *
 * @param importId 导入任务标识。
 */
async function publishImport(importId: string) {
  "use step";

  const db = getDatabase();
  const [importRecord] = await db
    .select({ fileVersionId: imports.fileVersionId, snapshotId: imports.snapshotId })
    .from(imports)
    .where(eq(imports.id, importId))
    .limit(1);
  if (!importRecord) throw new FatalError("Import record does not exist.");

  await db.transaction(async (transaction) => {
    await transaction
      .update(fileVersions)
      .set({ status: "indexed" })
      .where(eq(fileVersions.id, importRecord.fileVersionId));
    await transaction
      .update(indexSnapshots)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(indexSnapshots.id, importRecord.snapshotId));
    await transaction
      .update(imports)
      .set({ status: "completed", completedAt: new Date(), errorMessage: null })
      .where(eq(imports.id, importId));
  });
}

/**
 * 记录终态失败，不删除原始文件或已有快照。
 *
 * @param importId 导入任务标识。
 * @param message 脱敏后的失败信息。
 */
async function markImportFailed(importId: string, message: string) {
  "use step";

  await getDatabase()
    .update(imports)
    .set({ status: "failed", errorMessage: message.slice(0, 1_000), completedAt: new Date() })
    .where(eq(imports.id, importId));
}
