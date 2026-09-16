/**
 * 修改时间：2026-09-16
 * 文件说明：VaultAgent 导入批次 Durable Workflow 编排入口。
 *
 * 编排层只决定可恢复步骤顺序与批次原子发布；格式细节、视觉资产与向量模型
 * 分别停留在所属领域模块，避免 DAY6 接入 DOCX 后膨胀为格式判断中心。
 *
 * edit by：Sliye
 */

import { getErrorMessage } from "@/lib/ingestion/errors";
import {
  embedStoredChunks,
  analyzeIndexableImportVisualAssets,
  analyzeInheritedMarkdownAssets,
  failIndexableImport,
  failImportBatch,
  listBatchIndexableImports,
  markIndexableImportReady,
  parseAndStoreChunks,
  publishImportBatch,
  startBatchImport,
} from "@/workflows/ingest-import-batch/steps";
import { auditPublishedImport } from "@/workflows/ingest-import-batch/audit-step";

/**
 * 编排一个候选导入快照：每个可索引文件独立解析/向量化，全部就绪后才发布。
 *
 * @param batchId 导入批次标识。
 */
export async function ingestImportBatchWorkflow(batchId: string) {
  "use workflow";

  let embeddedChunkCount = 0;
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
    //这个循环为捉个文件处理，串行处理
    for (const indexableImport of indexableImports) {
      try {
        /**
         * 解析并保存 Chunk
         * importId -> 查询 imports + file_versions -> 拿到 storageKey、mediaType、snapshotId ->> 从本地磁盘或 Blob 读取文件 bytes ->> 按 MIME 分派对应解析器
         */
        
        await parseAndStoreChunks(indexableImport.id);
        /** PDF 无文本页与 DOCX 内嵌图片各自挑选候选，复用同一视觉资产持久化入口。 */
        await analyzeIndexableImportVisualAssets(
          indexableImport.id,
          indexableImport.mediaType,
        );
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
    /** 图片附件可以独立更新；为继承的 Markdown 补建新图片版本的视觉 Chunk。 */
    const inheritedMarkdownImports =
      await analyzeInheritedMarkdownAssets(batchId);
    for (const importId of inheritedMarkdownImports)
      embeddedChunkCount += await embedStoredChunks(importId);
    // 所有可索引文件都 ready后发布整个批次
    await publishImportBatch(batchId);
  } catch (error) {
    const errorMessage = getErrorMessage(
      error,
      "Import batch failed. Check the server logs for details.",
    );
    await failImportBatch(batchId, errorMessage);
    throw error;
  }
  // 发布已提交，审计失败只能重试审计，不得将成功的导入倒退成失败。
  await auditPublishedImport(batchId);
  return { embeddedChunkCount };
}
