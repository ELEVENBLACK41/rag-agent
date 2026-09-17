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
    /** 可索引文件共同占整体进度的 10%–90%，每个文件按三个真实阶段推进。 */
    const progressPerFile = indexableImports.length
      ? 80 / indexableImports.length
      : 0;
    //这个循环为捉个文件处理，串行处理
    for (
      let fileIndex = 0;
      fileIndex < indexableImports.length;
      fileIndex += 1
    ) {
      const indexableImport = indexableImports[fileIndex];
      const fileProgressStart = 10 + progressPerFile * fileIndex;
      const parsedProgress = fileProgressStart + progressPerFile * 0.25;
      const visualProgress = fileProgressStart + progressPerFile * 0.55;
      const embeddedProgress = fileProgressStart + progressPerFile;
      try {
        /**
         * 解析并保存 Chunk
         * importId -> 查询 imports + file_versions -> 拿到 storageKey、mediaType、snapshotId ->> 从本地磁盘或 Blob 读取文件 bytes ->> 按 MIME 分派对应解析器
         */
        await parseAndStoreChunks(indexableImport.id, {
          batchId,
          endPercent: parsedProgress,
        });
        /** PDF 无文本页与 DOCX 内嵌图片各自挑选候选，复用同一视觉资产持久化入口。 */
        await analyzeIndexableImportVisualAssets(
          indexableImport.id,
          indexableImport.mediaType,
          { batchId, endPercent: visualProgress },
        );
        /**
         * Embedding  查询当前文件版本下所有embedding IS NULL
         */
        embeddedChunkCount += await embedStoredChunks(indexableImport.id, {
          batchId,
          startPercent: visualProgress,
          endPercent: embeddedProgress,
        });
        //文件就绪 imports.status = running ->> ready
        await markIndexableImportReady(indexableImport.id, {
          batchId,
          endPercent: embeddedProgress,
          nextStage:
            fileIndex + 1 < indexableImports.length ? "parsing" : "visualizing",
        });
      } catch (error) {
        const message = getErrorMessage(error, "Import file failed.");
        await failIndexableImport(indexableImport.id, message);
        throw error;
      }
    }
    /** 图片附件可以独立更新；为继承的 Markdown 补建新图片版本的视觉 Chunk。 */
    const inheritedMarkdownImports =
      await analyzeInheritedMarkdownAssets(batchId);
    for (
      let importIndex = 0;
      importIndex < inheritedMarkdownImports.length;
      importIndex += 1
    ) {
      const startPercent =
        95 + (3 * importIndex) / inheritedMarkdownImports.length;
      const endPercent =
        95 + (3 * (importIndex + 1)) / inheritedMarkdownImports.length;
      embeddedChunkCount += await embedStoredChunks(
        inheritedMarkdownImports[importIndex],
        { batchId, startPercent, endPercent },
      );
    }
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
