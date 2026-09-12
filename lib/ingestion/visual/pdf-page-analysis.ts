/**
 * 修改时间：2026-09-12 | 文件说明：VaultAgent PDF 无文本页视觉分析编排与结果持久化 | edit by：Sliye
 */

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import {
  chunks,
  fileVersions,
  importDiagnostics,
  imports,
  visualAssets,
} from "@/lib/db/schema";
import { getErrorMessage } from "@/lib/ingestion/errors";
import {
  analyzeImage,
  VISUAL_MODEL,
  VISUAL_PROMPT_VERSION,
} from "@/lib/ingestion/visual/analyze-image";
import { renderPdfPage } from "@/lib/ingestion/visual/pdf-page-renderer";
import type { VisualAnalysis } from "@/lib/ingestion/visual/types";
import { createDerivedStorageKey, readStoredFile, writeStoredFile } from "@/lib/storage/files";

/** 单份 PDF 最多自动分析的无文本页数量。 */
const MAX_VISUAL_PAGES_PER_FILE = 2;
/** 单批导入最多分析的 PDF 页数量，限制模型费用。 */
const MAX_VISUAL_PAGES_PER_BATCH = 5;
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
    .limit(MAX_VISUAL_PAGES_PER_FILE);
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
  const availableCount = Math.max(0, MAX_VISUAL_PAGES_PER_BATCH - batchAssets.length);
  if (!availableCount) return 0;

  const existing = await db
    .select({ pageNumber: visualAssets.pageNumber })
    .from(visualAssets)
    .where(eq(visualAssets.fileVersionId, importRecord.fileVersionId));
  const existingPages = new Set(existing.map((asset) => asset.pageNumber));
  const pendingPages = pageNumbers
    .filter((pageNumber) => !existingPages.has(pageNumber))
    .slice(0, availableCount);
  if (!pendingPages.length) return 0;

  const pdfBytes = await readStoredFile(importRecord.storageKey);
  let completedCount = 0;
  for (const pageNumber of pendingPages) {
    let assetId: string | null = null;
    try {
      const rendered = await renderPdfPage(pdfBytes, pageNumber);
      assetId = randomUUID();
      const storageKey = createDerivedStorageKey(importRecord.workspaceId, assetId);
      await writeStoredFile(storageKey, rendered.png);
      await db.insert(visualAssets).values({
        id: assetId,
        importId,
        fileVersionId: importRecord.fileVersionId,
        pageNumber,
        mediaType: "image/png",
        storageKey,
        contentHash: createHash("sha256").update(rendered.png).digest("hex"),
        width: rendered.width,
        height: rendered.height,
        status: "running",
        modelId: VISUAL_MODEL,
        promptVersion: VISUAL_PROMPT_VERSION,
      });
      const analysis = await analyzeImage(rendered.png, "image/png");
      await storeVisualAnalysis({
        assetId,
        fileVersionId: importRecord.fileVersionId,
        snapshotId: await getSnapshotId(importId),
        pageNumber,
        analysis,
      });
      completedCount += 1;
    } catch (error) {
      if (assetId) {
        await db
          .update(visualAssets)
          .set({
            status: "failed",
            errorMessage: getErrorMessage(error, "PDF visual analysis failed."),
            completedAt: new Date(),
          })
          .where(eq(visualAssets.id, assetId));
      }
      console.error("[ingestion:visual] PDF page analysis failed", {
        importId,
        pageNumber,
        error: getErrorMessage(error, "Unknown PDF visual analysis error."),
      });
    }
  }
  return completedCount;
}

/** 保存模型结果并追加可检索的视觉描述 Chunk。 */
async function storeVisualAnalysis(input: {
  assetId: string;
  fileVersionId: string;
  snapshotId: string;
  pageNumber: number;
  analysis: VisualAnalysis;
}) {
  const db = getDatabase();
  const [lastChunk] = await db
    .select({ ordinal: chunks.ordinal })
    .from(chunks)
    .where(eq(chunks.fileVersionId, input.fileVersionId))
    .orderBy(desc(chunks.ordinal))
    .limit(1);
  const content = `【视觉分析·第 ${input.pageNumber} 页】\n${input.analysis.description}\n可见文字：${input.analysis.visibleText}`;
  await db.transaction(async (transaction) => {
    await transaction
      .update(visualAssets)
      .set({ status: "completed", analysis: input.analysis, completedAt: new Date() })
      .where(eq(visualAssets.id, input.assetId));
    await transaction.insert(chunks).values({
      id: randomUUID(),
      fileVersionId: input.fileVersionId,
      snapshotId: input.snapshotId,
      ordinal: (lastChunk?.ordinal ?? -1) + 1,
      content,
      contentHash: createHash("sha256").update(content).digest("hex"),
      startLine: null,
      endLine: null,
      sourceLocator: { format: "pdf-visual", pageNumber: input.pageNumber, visualAssetId: input.assetId },
    });
  });
}

/** 获取 Chunk 必须绑定的候选快照标识。 */
async function getSnapshotId(importId: string) {
  const [record] = await getDatabase()
    .select({ snapshotId: imports.snapshotId })
    .from(imports)
    .where(eq(imports.id, importId))
    .limit(1);
  if (!record) throw new Error("Import record does not exist.");
  return record.snapshotId;
}
