/**
 * 修改时间：2026-09-11 | 文件说明：VaultAgent 导入批次 Durable Workflow 编排入口 | edit by：Sliye
 */

import { getErrorMessage } from "@/lib/ingestion/errors";
import {
  embedStoredChunks,
  failIndexableImport,
  failImportBatch,
  listBatchIndexableImports,
  markIndexableImportReady,
  parseAndStoreChunks,
  publishImportBatch,
  startBatchImport,
} from "@/workflows/ingest-import-batch/steps";

/**
 * 编排一个候选导入快照：每个可索引文件独立解析/向量化，全部就绪后才发布。
 *
 * @param batchId 导入批次标识。
 */
export async function ingestImportBatchWorkflow(batchId: string) {
  "use workflow";

  try {
    await startBatchImport(batchId);
    const indexableImports = await listBatchIndexableImports(batchId);
    let embeddedChunkCount = 0;
    for (const indexableImport of indexableImports) {
      try {
        await parseAndStoreChunks(indexableImport.id);
        embeddedChunkCount += await embedStoredChunks(indexableImport.id);
        await markIndexableImportReady(indexableImport.id);
      } catch (error) {
        const message = getErrorMessage(error, "Import file failed.");
        await failIndexableImport(indexableImport.id, message);
        throw error;
      }
    }
    await publishImportBatch(batchId);
    return { embeddedChunkCount };
  } catch (error) {
    const errorMessage = getErrorMessage(
      error,
      "Import batch failed. Check the server logs for details.",
    );
    await failImportBatch(batchId, errorMessage);
    throw error;
  }
}
