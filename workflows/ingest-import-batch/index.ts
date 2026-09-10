/**
 * 修改时间：2026-09-10 | 文件说明：VaultAgent 导入批次 Durable Workflow 编排入口 | edit by：Sliye
 */

import { FatalError } from "workflow";
import {
  embedStoredChunks,
  failImportBatch,
  listBatchTextImports,
  markTextImportReady,
  parseAndStoreChunks,
  publishImportBatch,
  startBatchImport,
} from "@/workflows/ingest-import-batch/steps";

/**
 * 编排一个候选导入快照：每个文本文件独立解析/向量化，全部就绪后才发布。
 *
 * @param batchId 导入批次标识。
 */
export async function ingestImportBatchWorkflow(batchId: string) {
  "use workflow";

  try {
    await startBatchImport(batchId);
    const textImports = await listBatchTextImports(batchId);
    let embeddedChunkCount = 0;
    for (const textImport of textImports) {
      await parseAndStoreChunks(textImport.id);
      embeddedChunkCount += await embedStoredChunks(textImport.id);
      await markTextImportReady(textImport.id);
    }
    await publishImportBatch(batchId);
    return { embeddedChunkCount };
  } catch (error) {
    const errorMessage = error instanceof FatalError ? error.message : "Import batch failed. Check the server logs for details.";
    await failImportBatch(batchId, errorMessage);
    throw error;
  }
}
