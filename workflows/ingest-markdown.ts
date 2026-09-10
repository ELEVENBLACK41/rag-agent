/**
 * 修改时间：2026-09-07 | 文件说明：VaultAgent D2-D3 Markdown 持久化导入工作流
 * 此文件在导入md文件得api得route.ts中被调用，执行导入任务的核心逻辑
 *  | edit by：Sliye
 */

import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { embedMany, gateway } from "ai";
import { FatalError } from "workflow";
import { getDatabase } from "@/lib/db/client";
import { chunks, fileVersions, imports, indexSnapshots } from "@/lib/db/schema";
import { chunkMarkdown } from "@/lib/ingestion/markdown";
import { readStoredFile } from "@/lib/storage/files";

/**
 * 简要说明 ----------
 * vercel官方吧这种模式称为 Durable Workflow，也就是即使函数结束、服务器重启或网络中断，任务仍然可以继续
 * 概念说明：https://workflow-sdk.dev/docs/foundations/workflows-and-steps
 *
 */

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
 * 主函数本身只做调度，四个step，
 * 1 标记任务运行在
 * 2 读取文件并切块
 * 3 生成向量
 * 4 发布快照
 *
 * @param importId 导入任务标识。
 */
export async function ingestMarkdownWorkflow(importId: string) {
  "use workflow";

  try {
    //把导入记录状态改为“执行中”
    await markImportRunning(importId);
    //解析 Markdown 文件，并把内容切成多个文本块保存
    await parseAndStoreChunks(importId);
    //为文本块生成向量，并返回成功生成向量的数量
    const embeddedChunkCount = await embedStoredChunks(importId);
    //导入完成后，把结果发布或标记为可用
    await publishImport(importId);
    return { embeddedChunkCount };
  } catch (error) {
    //https://workflow-sdk.dev/docs/foundations/errors-and-retries 必须FatalError用来标记不可恢复的错误，Workflow 才会终止并进入失败状态
    const errorMessage =
      error instanceof FatalError
        ? error.message
        : "Markdown import failed. Check the server logs for details.";
    //把导入记录状态改为“失败” 入库
    await markImportFailed(importId, errorMessage);
    throw error;
  }
}

/**
 * 在持久化工作开始前更新业务任务状态。
 * 
 * imports.status:
 * queued → running
 * @param importId 导入任务标识。
 */
async function markImportRunning(importId: string) {
  "use step";

  await getDatabase()
    .update(imports)
    .set({ status: "running", errorMessage: null })
    .where(eq(imports.id, importId));
}

/**
 * 读取原始 Markdown 并幂等写入标题感知的文本块。
 * 步骤二 实际解析和切块
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
    fileBytes = await readStoredFile(importRecord.storageKey);
  } catch {
    throw new FatalError("The uploaded Markdown file cannot be read.");
  }

  let markdown: string;
  try {
    markdown = new TextDecoder("utf-8", { fatal: true }).decode(fileBytes);
  } catch {
    throw new FatalError("The uploaded file is not valid UTF-8 Markdown.");
  }

  //调用md切块器 
  const parsedChunks = chunkMarkdown(markdown);
  if (!parsedChunks.length)
    throw new FatalError("Markdown does not contain indexable text.");
  if (parsedChunks.length > MAX_CHUNKS_PER_IMPORT) {
    throw new FatalError(
      `Markdown exceeds the ${MAX_CHUNKS_PER_IMPORT} chunk import limit.`,
    );
  }

  await db
    .insert(chunks)
    .values(
      parsedChunks.map((chunk, ordinal) => ({
        id: randomUUID(),
        fileVersionId: importRecord.fileVersionId,
        snapshotId: importRecord.snapshotId,
        ordinal, //顺序编号
        content: chunk.content,//文本内容
        contentHash: createHash("sha256").update(chunk.content).digest("hex"),//文本 SHA-256
        startLine: chunk.startLine,//原文开始行号
        endLine: chunk.endLine,//原文结束行号
      })),
    )
    //onConflictDoNothing() 的作用是提高恢复时的幂等性：如果 Step 执行到一半后重试，已经写入的 Chunk 不会重复写入。
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

  //检查AI_GATEWAY_API_KEY是否填写
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new FatalError(
      "AI_GATEWAY_API_KEY is required before indexing Markdown.",
    );
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
    .where(
      and(
        eq(chunks.fileVersionId, importRecord.fileVersionId),
        isNull(chunks.embedding),
      ),
    )
    .orderBy(chunks.ordinal);

  for (let index = 0 ; index < pendingChunks.length ; index += EMBEDDING_BATCH_SIZE) {
    const batch = pendingChunks.slice(index, index + EMBEDDING_BATCH_SIZE);
    // https://ai-sdk.dev/docs/ai-sdk-core/embeddings
    //按照50个一批调用模型向量化文本
    const result = await embedMany({
      model: gateway.embeddingModel(EMBEDDING_MODEL),
      values: batch.map((chunk) => chunk.content),
    });
    //检查返回的向量维度
    if (
      result.embeddings.some(
        (embedding) => embedding.length !== EMBEDDING_DIMENSIONS,
      )
    ) {
      throw new FatalError(
        "Gateway returned an embedding with an unexpected dimension.",
      );
    }
    //把向量写回 PostgreSQL
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

/**
 * 仅在向量全部写入后，以事务方式发布导入快照。
 *
 * @param importId 导入任务标识。
 */
async function publishImport(importId: string) {
  "use step";

  const db = getDatabase();
  const [importRecord] = await db
    .select({
      fileVersionId: imports.fileVersionId,
      snapshotId: imports.snapshotId,
    })
    .from(imports)
    .where(eq(imports.id, importId))
    .limit(1);
  if (!importRecord) throw new FatalError("Import record does not exist.");
  /**
   * 三个状态在同一个数据库事务中更新：
   * fileVersions.status: indexed
   * indexSnapshots.status: published
   * imports.status: completed
   * 如果事务失败，三个状态一起回滚
   * */
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
    .set({
      status: "failed",
      errorMessage: message.slice(0, 1_000),
      completedAt: new Date(),
    })
    .where(eq(imports.id, importId));
}
