/**
 * 修改时间：2026-09-11 | 文件说明：VaultAgent 导入批次 Durable Workflow 编排入口 | edit by：Sliye
 */

import { getErrorMessage } from "@/lib/ingestion/errors";
import {
  embedStoredChunks,
  analyzeIndexableImportVisualPages,
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
    /**
     * 第一个step 
     * 批次：queued → running
     * 可索引文件：queued → running
     * 附件：保持 ready
     * 
     * */
    await startBatchImport(batchId);
    //找出本批需要处理得文件，按 MIME 类型筛选
    const indexableImports = await listBatchIndexableImports(batchId);
    let embeddedChunkCount = 0;
    //这个循环为捉个文件处理，串行处理
    for (const indexableImport of indexableImports) {
      try {
        /**
         * 解析并保存 Chunk
         * importId -> 查询 imports + file_versions -> 拿到 storageKey、mediaType、snapshotId ->> 从本地磁盘或 Blob 读取文件 bytes ->> 按 MIME 分派对应解析器
         */
        
        await parseAndStoreChunks(indexableImport.id);
        /**
         * 当前仅对 PDF 的无文本页做视觉分析。
         * Markdown、DOCX、XLSX 与独立图片的视觉候选提取、来源定位和资产持久化尚未接入；
         * 它们后续复用 analyzeImage()，不重复实现模型调用。
         */
        await analyzeIndexableImportVisualPages(indexableImport.id);
        /**
         * Embedding  查询当前文件版本下所有embedding IS NULL
         */
        embeddedChunkCount += await embedStoredChunks(indexableImport.id);
        //文件就绪 imports.status = running ->> ready
        await markIndexableImportReady(indexableImport.id);
      } catch (error) {
        const message = getErrorMessage(error, "Import file failed.");
        await failIndexableImport(indexableImport.id, message);
        throw error;
      }
    } 
    // 所有可索引文件都 ready后发布整个批次
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
