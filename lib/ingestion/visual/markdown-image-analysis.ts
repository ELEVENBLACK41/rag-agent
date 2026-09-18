/**
 * 修改时间：2026-09-16
 * 文件说明：Markdown 引用图片的受限视觉分析编排。
 *
 * 候选快照、附件版本和 Markdown 引用解析由 markdown-image-records 负责；本模块
 * 只执行视觉预算、图片尺寸门禁、模型调用和视觉 Chunk 写入。
 *
 * edit by：Sliye
 */

import { getErrorMessage } from "@/lib/ingestion/errors";
import { resolveMarkdownImageReferences } from "@/lib/ingestion/visual/markdown-image-references";
import {
  getAvailableBatchAssetCount,
  getBatchTarget,
  getExistingSourceKeys,
  getInheritedMarkdownImports,
  getMarkdownImport,
  type MarkdownImportRecord,
  type MarkdownVisualTarget,
} from "@/lib/ingestion/visual/markdown-image-records";
import {
  MAX_VISUAL_IMAGE_PIXELS,
  MIN_VISUAL_IMAGE_EDGE_PIXELS,
} from "@/lib/ingestion/visual/limits";
import {
  analyzeAndStoreImage,
  readImageDimensions,
} from "@/lib/ingestion/visual/stored-image-analysis";
import { createVisualSourceKey } from "@/lib/ingestion/visual/types";
import { readStoredFile } from "@/lib/storage/files";

/**
 * 为本批次 Markdown 正文引用的前几张图片建立视觉 Chunk。
 *
 * @param importId Markdown 文件的导入记录标识。
 */
export async function analyzeMarkdownVisualImages(importId: string) {
  const importRecord = await getMarkdownImport(importId);
  if (!importRecord?.sourcePath || !importRecord.batchId) return 0;
  return analyzeMarkdownImportVisualImages(importRecord, {
    batchId: importRecord.batchId,
    snapshotId: importRecord.snapshotId,
  });
}

/**
 * 图片附件单独更新时，为上一快照中继承的 Markdown 建立新图片版本的视觉 Chunk。
 * 返回新增 Chunk 所属的旧 Markdown 导入标识，供 Workflow 补做 Embedding。
 *
 * @param batchId 当前候选导入批次标识。
 */
export async function analyzeInheritedMarkdownVisualImages(batchId: string) {
  const target = await getBatchTarget(batchId);
  if (!target) return [];
  const inheritedImports = await getInheritedMarkdownImports(
    target.workspaceId,
    batchId,
  );
  const completedImportIds: string[] = [];
  for (const importRecord of inheritedImports) {
    const completedCount = await analyzeMarkdownImportVisualImages(
      importRecord,
      { batchId, snapshotId: target.snapshotId },
    );
    if (completedCount) completedImportIds.push(importRecord.importId);
  }
  return completedImportIds;
}

/** 为一个 Markdown 文件版本执行目标候选快照下的视觉分析。 */
async function analyzeMarkdownImportVisualImages(
  importRecord: MarkdownImportRecord,
  target: MarkdownVisualTarget,
) {
  if (!importRecord.sourcePath) return 0;
  const [references, existingSourceKeys, availableCount] = await Promise.all([
    resolveMarkdownImageReferences(importRecord, target.batchId),
    getExistingSourceKeys(importRecord.fileVersionId),
    getAvailableBatchAssetCount(target.batchId),
  ]);
  if (!availableCount) return 0;

  let attemptedCount = 0;
  let completedCount = 0;
  for (const reference of references) {
    if (attemptedCount >= availableCount) break;
    const sourceLocator = {
      kind: "markdown-image" as const,
      attachmentFileVersionId: reference.candidate.fileVersionId,
      sourcePath: reference.candidate.sourcePath,
      lineNumber: reference.startLine,
    };
    const sourceKey = createVisualSourceKey(sourceLocator);
    if (existingSourceKeys.has(sourceKey)) continue;
    const assetImportId = getAssetImportId(importRecord, reference, target);
    if (!assetImportId) continue;

    attemptedCount += 1;
    try {
      const image = await readStoredFile(reference.candidate.storageKey);
      const dimensions = readImageDimensions(
        image,
        reference.candidate.mediaType,
      );
      if (!isWithinVisualLimits(dimensions)) {
        console.warn("[ingestion:visual] Markdown image is outside visual size limits", {
          importId: importRecord.importId,
          sourcePath: reference.candidate.sourcePath,
          ...dimensions,
        });
        continue;
      }
      await analyzeAndStoreImage({
        importId: assetImportId,
        fileVersionId: importRecord.fileVersionId,
        snapshotId: target.snapshotId,
        workspaceId: importRecord.workspaceId,
        sourceLocator,
        sourceKey,
        image,
        mediaType: reference.candidate.mediaType,
        chunkLabel: `【视觉分析·Markdown 引用图片】\n附件路径：${reference.candidate.sourcePath}`,
        chunkLineRange: {
          startLine: reference.startLine,
          endLine: reference.endLine,
        },
        chunkLocator: (visualAssetId) => ({
          format: "markdown-visual",
          attachmentFileVersionId: reference.candidate.fileVersionId,
          attachmentPath: reference.candidate.sourcePath,
          lineNumber: reference.startLine,
          visualAssetId,
        }),
      });
      completedCount += 1;
    } catch (error) {
      console.error("[ingestion:visual] Markdown image analysis failed", {
        importId: importRecord.importId,
        sourcePath: reference.candidate.sourcePath,
        error: getErrorMessage(error, "Unknown Markdown image analysis error."),
      });
    }
  }
  return completedCount;
}

/** 视觉资产归入本批次实际触发分析的 Markdown 或图片导入记录。 */
function getAssetImportId(
  importRecord: MarkdownImportRecord,
  reference: Awaited<ReturnType<typeof resolveMarkdownImageReferences>>[number],
  target: MarkdownVisualTarget,
) {
  if (importRecord.batchId === target.batchId) return importRecord.importId;
  return reference.candidate.batchId === target.batchId
    ? reference.candidate.importId
    : null;
}

/** 复用跨格式像素边界，超限图片不调用模型。 */
function isWithinVisualLimits(dimensions: { width: number; height: number }) {
  return (
    dimensions.width >= MIN_VISUAL_IMAGE_EDGE_PIXELS &&
    dimensions.height >= MIN_VISUAL_IMAGE_EDGE_PIXELS &&
    dimensions.width * dimensions.height <= MAX_VISUAL_IMAGE_PIXELS
  );
}
