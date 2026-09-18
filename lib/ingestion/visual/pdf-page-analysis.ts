/**
 * 修改时间：2026-09-13
 * 文件说明：VaultAgent PDF 无文本页候选与受限视觉分析编排。
 *
 * 本模块只负责根据 PDF 页级诊断选择候选并渲染物理页；跨格式的派生资产写入、
 * 模型调用和视觉 Chunk 事务统一交给 stored-image-analysis，避免 PDF 专属复制。
 *
 * edit by：Sliye
 */

import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import {
  fileVersions,
  importDiagnostics,
  imports,
  visualAssets,
} from "@/lib/db/schema";
import { getErrorMessage } from "@/lib/ingestion/errors";
import { renderPdfPage } from "@/lib/ingestion/visual/pdf-page-renderer";
import {
  MAX_VISUAL_ASSETS_PER_IMPORT_BATCH,
  MAX_VISUAL_CANDIDATES_PER_FILE,
} from "@/lib/ingestion/visual/limits";
import { createVisualSourceKey } from "@/lib/ingestion/visual/types";
import { analyzeAndStoreImage } from "@/lib/ingestion/visual/stored-image-analysis";
import { readStoredFile } from "@/lib/storage/files";

/**
 * 对当前导入中自动候选的 PDF 无文本页执行渲染与视觉分析。
 * 分析失败不阻断文本 PDF 的索引与候选快照发布。
 *
 * @param importId PDF 导入记录标识。
 */
export async function analyzePdfVisualPages(importId: string) {
  const db = getDatabase();
  const [importRecord] = await db
    .select({
      batchId: imports.batchId,
      fileVersionId: imports.fileVersionId,
      snapshotId: imports.snapshotId,
      storageKey: fileVersions.storageKey,
      workspaceId: imports.workspaceId,
      mediaType: fileVersions.mediaType,
    })
    .from(imports)
    .innerJoin(fileVersions, eq(imports.fileVersionId, fileVersions.id))
    .where(eq(imports.id, importId))
    .limit(1);
  if (!importRecord || importRecord.mediaType !== "application/pdf") return 0;

  const candidates = await db
    .select({ pageNumber: importDiagnostics.pageNumber })
    .from(importDiagnostics)
    .where(
      and(
        eq(importDiagnostics.importId, importId),
        eq(importDiagnostics.code, "no-text-layer"),
      ),
    )
    .orderBy(importDiagnostics.pageNumber)
    .limit(MAX_VISUAL_CANDIDATES_PER_FILE);
  const pageNumbers = candidates
    .map((candidate) => candidate.pageNumber)
    .filter((pageNumber): pageNumber is number => pageNumber !== null);
  if (!pageNumbers.length) return 0;

  const batchAssets = importRecord.batchId
    ? await db
        .select({ id: visualAssets.id })
        .from(visualAssets)
        .innerJoin(imports, eq(visualAssets.importId, imports.id))
        .where(eq(imports.batchId, importRecord.batchId))
    : [];
  const availableCount = Math.max(
    0,
    MAX_VISUAL_ASSETS_PER_IMPORT_BATCH - batchAssets.length,
  );
  if (!availableCount) return 0;

  const existing = await db
    .select({ sourceKey: visualAssets.sourceKey })
    .from(visualAssets)
    .where(eq(visualAssets.fileVersionId, importRecord.fileVersionId));
  const existingSourceKeys = new Set(existing.map((asset) => asset.sourceKey));
  const pendingPages = pageNumbers
    .filter((pageNumber) =>
      !existingSourceKeys.has(
        createVisualSourceKey({ kind: "pdf-page", pageNumber }),
      ),
    )
    .slice(0, availableCount);
  if (!pendingPages.length) return 0;

  const pdfBytes = await readStoredFile(importRecord.storageKey);
  let completedCount = 0;
  for (const pageNumber of pendingPages) {
    try {
      const rendered = await renderPdfPage(pdfBytes, pageNumber);
      const sourceLocator = { kind: "pdf-page" as const, pageNumber };
      await analyzeAndStoreImage({
        importId,
        fileVersionId: importRecord.fileVersionId,
        snapshotId: importRecord.snapshotId,
        workspaceId: importRecord.workspaceId,
        sourceLocator,
        sourceKey: createVisualSourceKey(sourceLocator),
        image: rendered.png,
        mediaType: "image/png",
        chunkLabel: `【视觉分析·第 ${pageNumber} 页】`,
        chunkLocator: (visualAssetId) => ({
          format: "pdf-visual",
          pageNumber,
          visualAssetId,
        }),
      });
      completedCount += 1;
    } catch (error) {
      console.error("[ingestion:visual] PDF page analysis failed", {
        importId,
        pageNumber,
        error: getErrorMessage(error, "Unknown PDF visual analysis error."),
      });
    }
  }
  return completedCount;
}
