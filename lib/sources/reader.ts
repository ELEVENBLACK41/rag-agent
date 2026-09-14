/**
 * 修改时间：2026-09-14
 * 文件说明：VaultAgent 固定 Run 快照下的来源读取与原文件访问授权。
 *
 * 所有来源读取都从 Run、快照、Chunk 和文件版本重新建立关系。调用方只能得到
 * 已验证内容，不能通过 Chunk ID、文件版本 ID 或存储键跨快照读取私有资料。
 *
 * edit by：Sliye
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import {
  chunks,
  conversations,
  fileVersions,
  indexSnapshotFiles,
  logicalFiles,
  runs,
  visualAssets,
} from "@/lib/db/schema";
import { toSourceLocator } from "@/lib/ingestion/formats/types";
import { LOCAL_WORKSPACE_ID } from "@/lib/ingestion/imports";
import { readStoredFile } from "@/lib/storage/files";
import type { ReadableSource } from "@/lib/sources/types";

/**
 * 读取 Agent 已发现的有限 Chunk。快照成员、文件状态与逻辑删除状态均在查询中校验。
 *
 * @param snapshotId 当前 Run 固定的不可变索引快照。
 * @param chunkIds 模型从搜索结果中选择的 Chunk 标识。
 */
export async function readSnapshotSources(
  snapshotId: string,
  chunkIds: string[],
): Promise<ReadableSource[]> {
  if (!chunkIds.length) return [];

  const records = await getDatabase()
    .select({
      chunkId: chunks.id,
      content: chunks.content,
      displayName: logicalFiles.displayName,
      startLine: chunks.startLine,
      endLine: chunks.endLine,
      sourceLocator: chunks.sourceLocator,
    })
    .from(chunks)
    .innerJoin(fileVersions, eq(chunks.fileVersionId, fileVersions.id))
    .innerJoin(
      indexSnapshotFiles,
      and(
        eq(indexSnapshotFiles.snapshotId, snapshotId),
        eq(indexSnapshotFiles.fileVersionId, fileVersions.id),
      ),
    )
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .where(
      and(
        eq(chunks.snapshotId, snapshotId),
        inArray(chunks.id, chunkIds),
        eq(fileVersions.status, "indexed"),
        isNull(logicalFiles.deletedAt),
      ),
    );

  const byId = new Map(records.map((record) => [record.chunkId, record]));
  return chunkIds.flatMap((chunkId) => {
    const record = byId.get(chunkId);
    if (!record) return [];
    return [{
      id: 0,
      chunkId: record.chunkId,
      displayName: record.displayName,
      startLine: record.startLine,
      endLine: record.endLine,
      sourceLocator: toSourceLocator(record.sourceLocator),
      content: record.content,
    }];
  });
}

/**
 * 验证某个 Run 可以读取的单条来源。该查询是所有来源 API 的唯一授权边界。
 *
 * @param runId 用户当前可见的 Run 标识。
 * @param chunkId 回答引用的 Chunk 标识。
 */
export async function getRunSourceRecord(runId: string, chunkId: string) {
  const [record] = await getDatabase()
    .select({
      chunkId: chunks.id,
      content: chunks.content,
      displayName: logicalFiles.displayName,
      mediaType: fileVersions.mediaType,
      startLine: chunks.startLine,
      endLine: chunks.endLine,
      sourceLocator: chunks.sourceLocator,
      fileVersionId: fileVersions.id,
      storageKey: fileVersions.storageKey,
    })
    .from(runs)
    .innerJoin(conversations, eq(runs.conversationId, conversations.id))
    .innerJoin(chunks, eq(chunks.snapshotId, runs.snapshotId))
    .innerJoin(fileVersions, eq(chunks.fileVersionId, fileVersions.id))
    .innerJoin(
      indexSnapshotFiles,
      and(
        eq(indexSnapshotFiles.snapshotId, runs.snapshotId),
        eq(indexSnapshotFiles.fileVersionId, fileVersions.id),
      ),
    )
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .where(
      and(
        eq(runs.id, runId),
        eq(conversations.workspaceId, LOCAL_WORKSPACE_ID),
        isNull(conversations.deletedAt),
        eq(chunks.id, chunkId),
        eq(fileVersions.status, "indexed"),
        isNull(logicalFiles.deletedAt),
      ),
    )
    .limit(1);

  return record ?? null;
}

/** 读取来源抽屉可安全返回的原文件字节。 */
export async function readRunSourceFile(runId: string, chunkId: string) {
  const record = await getRunSourceRecord(runId, chunkId);
  if (!record) return null;
  return {
    bytes: await readStoredFile(record.storageKey),
    displayName: record.displayName,
    mediaType: record.mediaType,
  };
}

/** 读取视觉 Chunk 关联的派生图片，视觉资产必须属于同一个文件版本且已完成。 */
export async function readRunVisualAsset(runId: string, chunkId: string) {
  const record = await getRunSourceRecord(runId, chunkId);
  if (!record) return null;

  const locator = toSourceLocator(record.sourceLocator);
  if (
    !locator ||
    (locator.format !== "pdf-visual" &&
      locator.format !== "docx-visual" &&
      locator.format !== "xlsx-visual")
  ) return null;
  const assetId = locator.visualAssetId;

  const [asset] = await getDatabase()
    .select({ mediaType: visualAssets.mediaType, storageKey: visualAssets.storageKey })
    .from(visualAssets)
    .where(
      and(
        eq(visualAssets.id, assetId),
        eq(visualAssets.fileVersionId, record.fileVersionId),
        eq(visualAssets.status, "completed"),
      ),
    )
    .limit(1);
  if (!asset) return null;

  return { bytes: await readStoredFile(asset.storageKey), mediaType: asset.mediaType };
}
