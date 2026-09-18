/**
 * 修改时间：2026-09-16
 * 文件说明：Markdown 图片视觉索引的候选快照、导入记录与预算查询。
 *
 * 当前批次文件覆盖上一快照同路径版本；继承 Markdown 只在引用了本批新图片时
 * 才会交给视觉编排，避免无关导入触发模型调用。
 *
 * edit by：Sliye
 */

import { and, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import {
  chunks,
  fileVersions,
  importBatches,
  imports,
  indexSnapshotFiles,
  indexSnapshots,
  logicalFiles,
  visualAssets,
} from "@/lib/db/schema";
import {
  MAX_VISUAL_ASSETS_PER_IMPORT_BATCH,
  MAX_VISUAL_CANDIDATES_PER_FILE,
} from "@/lib/ingestion/visual/limits";
import type { SupportedVisualMediaType } from "@/lib/ingestion/visual/stored-image-analysis";

/** Markdown 本地图片当前只允许使用导入入口已支持的 PNG/JPEG。 */
const MARKDOWN_IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg"];
export type MarkdownImportRecord = NonNullable<
  Awaited<ReturnType<typeof getMarkdownImport>>
>;

export type MarkdownVisualTarget = {
  batchId: string;
  snapshotId: string;
};

export type MarkdownImageCandidate = {
  batchId: string | null;
  fileVersionId: string;
  importId: string;
  mediaType: SupportedVisualMediaType;
  sourcePath: string;
  storageKey: string;
};

/** 查询并验证当前导入确实是带稳定 Vault 路径的 Markdown 文件。 */
export async function getMarkdownImport(importId: string) {
  const [record] = await getDatabase()
    .select({
      batchId: imports.batchId,
      importId: imports.id,
      fileVersionId: imports.fileVersionId,
      snapshotId: imports.snapshotId,
      workspaceId: imports.workspaceId,
      sourcePath: logicalFiles.sourcePath,
      mediaType: fileVersions.mediaType,
    })
    .from(imports)
    .innerJoin(fileVersions, eq(imports.fileVersionId, fileVersions.id))
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .where(eq(imports.id, importId))
    .limit(1);
  return record?.mediaType === "text/markdown" ? record : null;
}

/** 查询当前批次的工作区与待发布快照。 */
export async function getBatchTarget(batchId: string) {
  const [record] = await getDatabase()
    .select({
      snapshotId: importBatches.snapshotId,
      workspaceId: importBatches.workspaceId,
    })
    .from(importBatches)
    .where(eq(importBatches.id, batchId))
    .limit(1);
  return record ?? null;
}

/** 读取上一快照中会被当前批次继承的 Markdown；已上传的新版本不重复处理。 */
export async function getInheritedMarkdownImports(
  workspaceId: string,
  batchId: string,
): Promise<MarkdownImportRecord[]> {
  const db = getDatabase();
  const [previousSnapshot] = await db
    .select({ id: indexSnapshots.id })
    .from(indexSnapshots)
    .where(
      and(
        eq(indexSnapshots.workspaceId, workspaceId),
        eq(indexSnapshots.status, "published"),
      ),
    )
    .orderBy(desc(indexSnapshots.publishedAt))
    .limit(1);
  if (!previousSnapshot) return [];
  const currentFiles = await db
    .select({ logicalFileId: fileVersions.logicalFileId })
    .from(imports)
    .innerJoin(fileVersions, eq(imports.fileVersionId, fileVersions.id))
    .where(eq(imports.batchId, batchId));
  const replacedLogicalFileIds = currentFiles.map((file) => file.logicalFileId);

  return db
    .select({
      batchId: imports.batchId,
      importId: imports.id,
      fileVersionId: imports.fileVersionId,
      snapshotId: imports.snapshotId,
      workspaceId: imports.workspaceId,
      sourcePath: logicalFiles.sourcePath,
      mediaType: fileVersions.mediaType,
    })
    .from(indexSnapshotFiles)
    .innerJoin(fileVersions, eq(indexSnapshotFiles.fileVersionId, fileVersions.id))
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .innerJoin(imports, eq(imports.fileVersionId, fileVersions.id))
    .where(
      and(
        eq(indexSnapshotFiles.snapshotId, previousSnapshot.id),
        eq(fileVersions.mediaType, "text/markdown"),
        isNull(logicalFiles.deletedAt),
        replacedLogicalFileIds.length
          ? notInArray(fileVersions.logicalFileId, replacedLogicalFileIds)
          : undefined,
      ),
    );
}

/** 从同一 Markdown 文件版本读取来源键，使 Workflow 重放不会重复调用模型。 */
export async function getExistingSourceKeys(fileVersionId: string) {
  const records = await getDatabase()
    .select({ sourceKey: visualAssets.sourceKey })
    .from(visualAssets)
    .where(eq(visualAssets.fileVersionId, fileVersionId));
  return new Set(records.map((record) => record.sourceKey));
}

/** 读取所有格式共享的批次视觉预算，并保留单文件候选上限。 */
export async function getAvailableBatchAssetCount(batchId: string) {
  const records = await getDatabase()
    .select({ id: visualAssets.id })
    .from(visualAssets)
    .innerJoin(imports, eq(visualAssets.importId, imports.id))
    .where(eq(imports.batchId, batchId));
  return Math.max(
    0,
    Math.min(
      MAX_VISUAL_CANDIDATES_PER_FILE,
      MAX_VISUAL_ASSETS_PER_IMPORT_BATCH - records.length,
    ),
  );
}

/** 读取 Markdown Chunk；代码块中的图片语法不会成为视觉候选。 */
export function getMarkdownChunkReferences(fileVersionId: string) {
  return getDatabase()
    .select({
      startLine: chunks.startLine,
      endLine: chunks.endLine,
      sourceLocator: chunks.sourceLocator,
    })
    .from(chunks)
    .where(eq(chunks.fileVersionId, fileVersionId))
    .orderBy(chunks.ordinal);
}

/** 组装待发布快照图片成员；当前批次同路径版本覆盖上一快照版本。 */
export async function getCandidateSnapshotImages(
  workspaceId: string,
  batchId: string,
): Promise<MarkdownImageCandidate[]> {
  const db = getDatabase();
  const current = await getCurrentBatchImages(batchId);
  const [previousSnapshot] = await db
    .select({ id: indexSnapshots.id })
    .from(indexSnapshots)
    .where(
      and(
        eq(indexSnapshots.workspaceId, workspaceId),
        eq(indexSnapshots.status, "published"),
      ),
    )
    .orderBy(desc(indexSnapshots.publishedAt))
    .limit(1);
  const inherited = previousSnapshot
    ? await getSnapshotImages(previousSnapshot.id)
    : [];

  const byPath = new Map<string, MarkdownImageCandidate>();
  for (const candidate of [...inherited, ...current]) {
    if (!candidate.sourcePath || !isSupportedMediaType(candidate.mediaType)) continue;
    byPath.set(candidate.sourcePath, {
      ...candidate,
      sourcePath: candidate.sourcePath,
      mediaType: candidate.mediaType,
    });
  }
  return [...byPath.values()];
}

/** 查询当前批次上传的图片版本。 */
function getCurrentBatchImages(batchId: string) {
  return getDatabase()
    .select({
      batchId: imports.batchId,
      fileVersionId: fileVersions.id,
      importId: imports.id,
      mediaType: fileVersions.mediaType,
      sourcePath: logicalFiles.sourcePath,
      storageKey: fileVersions.storageKey,
    })
    .from(imports)
    .innerJoin(fileVersions, eq(imports.fileVersionId, fileVersions.id))
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .where(
      and(
        eq(imports.batchId, batchId),
        inArray(fileVersions.mediaType, MARKDOWN_IMAGE_MEDIA_TYPES),
        isNull(logicalFiles.deletedAt),
      ),
    );
}

/** 查询一个已发布快照中的图片版本。 */
function getSnapshotImages(snapshotId: string) {
  return getDatabase()
    .select({
      batchId: imports.batchId,
      fileVersionId: fileVersions.id,
      importId: imports.id,
      mediaType: fileVersions.mediaType,
      sourcePath: logicalFiles.sourcePath,
      storageKey: fileVersions.storageKey,
    })
    .from(indexSnapshotFiles)
    .innerJoin(fileVersions, eq(indexSnapshotFiles.fileVersionId, fileVersions.id))
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .innerJoin(imports, eq(imports.fileVersionId, fileVersions.id))
    .where(
      and(
        eq(indexSnapshotFiles.snapshotId, snapshotId),
        inArray(fileVersions.mediaType, MARKDOWN_IMAGE_MEDIA_TYPES),
        isNull(logicalFiles.deletedAt),
      ),
    );
}

/** 将数据库字符串收窄为当前视觉入口实际支持的媒体类型。 */
function isSupportedMediaType(
  mediaType: string,
): mediaType is SupportedVisualMediaType {
  return mediaType === "image/png" || mediaType === "image/jpeg";
}
