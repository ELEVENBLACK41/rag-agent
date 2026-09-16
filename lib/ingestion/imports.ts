/**
 * 修改时间：2026-09-17
 * 文件说明：VaultAgent 多文件导入批次、版本与候选快照发布。
 *
 * 此模块是文件版本、批次状态和快照原子切换的业务事实来源；格式解析与视觉
 * 模型调用不在此处实现，只汇总它们已持久化的用户可见状态。
 *
 * edit by：Sliye
 */

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import {
  fileVersions,
  importBatches,
  imports,
  indexSnapshotFiles,
  indexSnapshots,
  logicalFiles,
  principals,
  visualAssets,
  workspaces,
} from "@/lib/db/schema";
import { INDEXABLE_MEDIA_TYPES, isIndexableMediaType } from "@/lib/ingestion/formats/file-types";
import { getImportDiagnostics } from "@/lib/ingestion/import-diagnostics";
import {
  createStorageKey,
  deleteStoredFile,
  writeStoredFile,
} from "@/lib/storage/files";

/** 本地开发模式下唯一的工作区标识。 */
export const LOCAL_WORKSPACE_ID = "local-default-workspace";
/** 本地开发模式下唯一的所有者标识。 */
export const LOCAL_OWNER_ID = "local-owner";

export type VaultUploadFile = {
  relativePath: string;
  bytes: Uint8Array;
  mediaType: string;
  kind: "index" | "attachment";
};

type PendingStoredFile = {
  importId: string;
  fileVersionId: string;
  storageKey: string;
  bytes: Uint8Array;
};

/** 在不暴露公开多租户入口的前提下，创建本地唯一工作区和所有者身份。 */
export async function ensureLocalPrincipal() {
  const db = getDatabase();
  await db
    .insert(workspaces)
    .values({ id: LOCAL_WORKSPACE_ID, mode: "local" })
    .onConflictDoNothing();
  await db
    .insert(principals)
    .values({
      id: LOCAL_OWNER_ID,
      workspaceId: LOCAL_WORKSPACE_ID,
      kind: "owner",
    })
    .onConflictDoNothing();
}

/**
 * 将一个受校验的文件批次保存为候选快照；可索引文件待 Workflow 处理，图片附件只保留原始文件和路径。
 *
 * @param files 已通过上传入口类型、路径和总量校验的文件。
 */
export async function createLocalImportBatch(files: VaultUploadFile[]) {
  await ensureLocalPrincipal();
  const db = getDatabase();
  const batchId = randomUUID();
  const snapshotId = randomUUID();
  const pendingFiles: PendingStoredFile[] = [];

  await db.transaction(async (transaction) => {
    await transaction.insert(indexSnapshots).values({
      id: snapshotId,
      workspaceId: LOCAL_WORKSPACE_ID,
      status: "building",
    });
    await transaction.insert(importBatches).values({
      id: batchId,
      workspaceId: LOCAL_WORKSPACE_ID,
      snapshotId,
      status: "queued",
    });

    for (const file of files) {
      const [existingFile] = await transaction
        .select({ id: logicalFiles.id })
        .from(logicalFiles)
        .where(
          and(
            eq(logicalFiles.workspaceId, LOCAL_WORKSPACE_ID),
            eq(logicalFiles.sourcePath, file.relativePath),
          ),
        )
        .limit(1);
      const logicalFileId = existingFile?.id ?? randomUUID();
      const displayName =
        file.relativePath.split("/").at(-1) ?? file.relativePath;

      if (existingFile) {
        await transaction
          .update(logicalFiles)
          .set({ displayName, deletedAt: null })
          .where(eq(logicalFiles.id, logicalFileId));
      } else {
        await transaction.insert(logicalFiles).values({
          id: logicalFileId,
          workspaceId: LOCAL_WORKSPACE_ID,
          displayName,
          sourcePath: file.relativePath,
        });
      }

      const [latestVersion] = await transaction
        .select({ versionNumber: fileVersions.versionNumber })
        .from(fileVersions)
        .where(eq(fileVersions.logicalFileId, logicalFileId))
        .orderBy(desc(fileVersions.versionNumber))
        .limit(1);
      const fileVersionId = randomUUID();
      const importId = randomUUID();
      const storageKey = createStorageKey(LOCAL_WORKSPACE_ID, fileVersionId);

      await transaction.insert(fileVersions).values({
        id: fileVersionId,
        logicalFileId,
        versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
        contentHash: createHash("sha256").update(file.bytes).digest("hex"),
        mediaType: file.mediaType,
        byteSize: file.bytes.byteLength,
        storageKey,
        status: file.kind === "index" ? "queued" : "stored",
      });
      await transaction.insert(imports).values({
        id: importId,
        workspaceId: LOCAL_WORKSPACE_ID,
        fileVersionId,
        snapshotId,
        batchId,
        status: file.kind === "index" ? "queued" : "ready",
      });
      pendingFiles.push({
        importId,
        fileVersionId,
        storageKey,
        bytes: file.bytes,
      });
    }
  });

  try {
    for (const file of pendingFiles)
      await writeStoredFile(file.storageKey, file.bytes);
  } catch (error) {
    await markBatchStorageFailed(batchId);
    throw error;
  }

  return { batchId, snapshotId };
}

/** 读取一个批次的浏览器展示状态，不返回原始文件内容
 * 给前端查询导入状态
 */
export async function getLocalImportBatchStatus(batchId: string) {
  const db = getDatabase();
  const [batch] = await db
    .select({
      id: importBatches.id,
      status: importBatches.status,
      errorMessage: importBatches.errorMessage,
    })
    .from(importBatches)
    .where(eq(importBatches.id, batchId))
    .limit(1);
  if (!batch) return null;

  const files = await db
    .select({
      id: imports.id,
      status: imports.status,
      errorMessage: imports.errorMessage,
      displayName: logicalFiles.displayName,
      sourcePath: logicalFiles.sourcePath,
      mediaType: fileVersions.mediaType,
    })
    .from(imports)
    .innerJoin(fileVersions, eq(imports.fileVersionId, fileVersions.id))
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .where(eq(imports.batchId, batchId));

  const diagnosticsByImport = await getImportDiagnostics(files.map((file) => file.id));
  const visualAssetRecords = files.length
    ? await db
        .select({
          importId: visualAssets.importId,
          pageNumber: visualAssets.pageNumber,
          sourceKey: visualAssets.sourceKey,
          status: visualAssets.status,
          errorMessage: visualAssets.errorMessage,
        })
        .from(visualAssets)
        .where(inArray(visualAssets.importId, files.map((file) => file.id)))
        .orderBy(visualAssets.sourceKey)
    : [];
  const visualAssetsByImport = new Map<string, typeof visualAssetRecords>();
  for (const asset of visualAssetRecords) {
    const assets = visualAssetsByImport.get(asset.importId) ?? [];
    assets.push(asset);
    visualAssetsByImport.set(asset.importId, assets);
  }
  return {
    ...batch,
    files: files.map((file) => ({
      ...file,
      diagnostics: diagnosticsByImport.get(file.id) ?? [],
      visualAssets: visualAssetsByImport.get(file.id) ?? [],
    })),
  };
}

/**
 * 读取当前已发布快照中的文件清单。每个逻辑路径只会出现快照实际使用的版本，
 * 因此列表中的“AI 当前使用”与检索范围保持一致。
 */
export async function getCurrentLibraryFiles() {
  const db = getDatabase();
  const [snapshot] = await db
    .select({
      id: indexSnapshots.id,
      publishedAt: indexSnapshots.publishedAt,
    })
    .from(indexSnapshots)
    .where(
      and(
        eq(indexSnapshots.workspaceId, LOCAL_WORKSPACE_ID),
        eq(indexSnapshots.status, "published"),
      ),
    )
    .orderBy(desc(indexSnapshots.publishedAt))
    .limit(1);

  if (!snapshot) return { snapshotId: null, publishedAt: null, files: [] };

  const files = await db
    .select({
      id: imports.id,
      status: imports.status,
      errorMessage: imports.errorMessage,
      displayName: logicalFiles.displayName,
      sourcePath: logicalFiles.sourcePath,
      mediaType: fileVersions.mediaType,
      versionNumber: fileVersions.versionNumber,
      byteSize: fileVersions.byteSize,
      updatedAt: fileVersions.createdAt,
      fileVersionId: fileVersions.id,
      indexStatus: fileVersions.status,
    })
    .from(indexSnapshotFiles)
    .innerJoin(fileVersions, eq(indexSnapshotFiles.fileVersionId, fileVersions.id))
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .innerJoin(imports, eq(imports.fileVersionId, fileVersions.id))
    .where(
      and(
        eq(indexSnapshotFiles.snapshotId, snapshot.id),
        isNull(logicalFiles.deletedAt),
      ),
    )
    .orderBy(desc(fileVersions.createdAt), desc(fileVersions.id));

  const latestFilesByPath = new Map<string, (typeof files)[number]>();
  for (const file of files) {
    // D3 旧数据没有 sourcePath，使用当时保存的文件名与后续同名根目录文件对齐。
    const identity = file.sourcePath ?? file.displayName;
    if (!latestFilesByPath.has(identity)) latestFilesByPath.set(identity, file);
  }
  const activeFiles = [...latestFilesByPath.values()].sort((left, right) =>
    (left.sourcePath ?? left.displayName).localeCompare(
      right.sourcePath ?? right.displayName,
      "zh-CN",
    ),
  );

  return {
    snapshotId: snapshot.id,
    publishedAt: snapshot.publishedAt,
    files: activeFiles.map((file) => ({
      id: file.id,
      status: file.status,
      errorMessage: file.errorMessage,
      displayName: file.displayName,
      sourcePath: file.sourcePath,
      mediaType: file.mediaType,
      versionNumber: file.versionNumber,
      byteSize: file.byteSize,
      updatedAt: file.updatedAt,
      fileVersionId: file.fileVersionId,
      isQueryable: file.indexStatus === "indexed" && isIndexableMediaType(file.mediaType),
      isActiveVersion: true as const,
      diagnostics: [],
      visualAssets: [],
    })),
  };
}

/** 关联已启动的持久化 Workflow Run
 * workflow 启动后会返回一个runid
 */
export async function setImportBatchWorkflowRun(
  batchId: string,
  workflowRunId: string,
) {
  await getDatabase()
    .update(importBatches)
    .set({ workflowRunId })
    .where(eq(importBatches.id, batchId));
}

/** 调度未成功时使批次及其未完成文件显式失败。 */
export async function recordImportBatchDispatchError(batchId: string) {
  await markBatchFailed(batchId, "Workflow dispatch failed.");
}

/**
 * 删除一个逻辑文件并发布排除该文件的新快照，旧快照继续作为历史 Run 的证据。
 *
 * @param importId 当前文件的导入记录标识。
 */
export async function deleteLocalImport(importId: string) {
  const db = getDatabase();
  const [target] = await db
    .select({
      workspaceId: imports.workspaceId,
      fileVersionId: imports.fileVersionId,
      logicalFileId: fileVersions.logicalFileId,
      storageKey: fileVersions.storageKey,
    })
    .from(imports)
    .innerJoin(fileVersions, eq(imports.fileVersionId, fileVersions.id))
    .where(eq(imports.id, importId))
    .limit(1);
  if (!target) return false;

  await deleteStoredFile(target.storageKey);
  const [currentSnapshot] = await db
    .select({ id: indexSnapshots.id })
    .from(indexSnapshots)
    .where(
      and(
        eq(indexSnapshots.workspaceId, target.workspaceId),
        eq(indexSnapshots.status, "published"),
      ),
    )
    .orderBy(desc(indexSnapshots.publishedAt))
    .limit(1);

  await db.transaction(async (transaction) => {
    await transaction
      .update(fileVersions)
      .set({ status: "deleted" })
      .where(eq(fileVersions.id, target.fileVersionId));
    await transaction
      .update(logicalFiles)
      .set({ deletedAt: new Date() })
      .where(eq(logicalFiles.id, target.logicalFileId));
    await transaction
      .update(imports)
      .set({ status: "deleted", completedAt: new Date() })
      .where(eq(imports.id, importId));
    if (!currentSnapshot) return;

    const nextSnapshotId = randomUUID();
    const remaining = await transaction
      .select({ fileVersionId: indexSnapshotFiles.fileVersionId })
      .from(indexSnapshotFiles)
      .innerJoin(
        fileVersions,
        eq(indexSnapshotFiles.fileVersionId, fileVersions.id),
      )
      .where(
        and(
          eq(indexSnapshotFiles.snapshotId, currentSnapshot.id),
          ne(fileVersions.logicalFileId, target.logicalFileId),
        ),
      );
    await transaction.insert(indexSnapshots).values({
      id: nextSnapshotId,
      workspaceId: target.workspaceId,
      status: "published",
      publishedAt: new Date(),
    });
    if (remaining.length) {
      await transaction
        .insert(indexSnapshotFiles)
        .values(
          remaining.map((item) => ({
            snapshotId: nextSnapshotId,
            fileVersionId: item.fileVersionId,
          })),
        );
    }
  });
  return true;
}

/** 供 Workflow 读取本批次待处理的已注册可索引文件。 */
export async function getBatchIndexableImports(batchId: string) {
  return getDatabase()
    .select({ id: imports.id, mediaType: fileVersions.mediaType })
    .from(imports)
    .innerJoin(fileVersions, eq(imports.fileVersionId, fileVersions.id))
    .where(
      and(
        eq(imports.batchId, batchId),
        inArray(fileVersions.mediaType, INDEXABLE_MEDIA_TYPES),
      ),
    );
}

/** 批次完成后将旧快照成员与本批次的新版本合并，并作为一个事务发布。 */
export async function publishImportBatch(batchId: string) {
  const db = getDatabase();
  const [batch] = await db
    .select({
      workspaceId: importBatches.workspaceId,
      snapshotId: importBatches.snapshotId,
    })
    .from(importBatches)
    .where(eq(importBatches.id, batchId))
    .limit(1);
  if (!batch) throw new Error("Import batch does not exist.");

  await db.transaction(async (transaction) => {
    const batchFiles = await transaction
      .select({
        fileVersionId: imports.fileVersionId,
        logicalFileId: fileVersions.logicalFileId,
        mediaType: fileVersions.mediaType,
      })
      .from(imports)
      .innerJoin(fileVersions, eq(imports.fileVersionId, fileVersions.id))
      .where(eq(imports.batchId, batchId));
    const unfinished = await transaction
      .select({ id: imports.id })
      .from(imports)
      .where(and(eq(imports.batchId, batchId), ne(imports.status, "ready")));
    if (unfinished.length)
      throw new Error("Import batch still has unfinished files.");

    const [previous] = await transaction
      .select({ id: indexSnapshots.id })
      .from(indexSnapshots)
      .where(
        and(
          eq(indexSnapshots.workspaceId, batch.workspaceId),
          eq(indexSnapshots.status, "published"),
        ),
      )
      .orderBy(desc(indexSnapshots.publishedAt))
      .limit(1);
    const replacedLogicalFileIds = batchFiles.map((file) => file.logicalFileId);
    const inherited = previous
      ? await transaction
          .select({ fileVersionId: indexSnapshotFiles.fileVersionId })
          .from(indexSnapshotFiles)
          .innerJoin(
            fileVersions,
            eq(indexSnapshotFiles.fileVersionId, fileVersions.id),
          )
          .where(
            replacedLogicalFileIds.length
              ? and(
                  eq(indexSnapshotFiles.snapshotId, previous.id),
                  notInArray(
                    fileVersions.logicalFileId,
                    replacedLogicalFileIds,
                  ),
                )
              : eq(indexSnapshotFiles.snapshotId, previous.id),
          )
      : [];
    const inheritedIds = new Set(inherited.map((file) => file.fileVersionId));
    const nextFileVersionIds = [
      ...inheritedIds,
      ...batchFiles.map((file) => file.fileVersionId),
    ];

    if (nextFileVersionIds.length) {
      await transaction
        .insert(indexSnapshotFiles)
        .values(
          nextFileVersionIds.map((fileVersionId) => ({
            snapshotId: batch.snapshotId,
            fileVersionId,
          })),
        );
    }
    const indexedFileVersionIds = batchFiles
      .filter((file) => isIndexableMediaType(file.mediaType))
      .map((file) => file.fileVersionId);
    if (indexedFileVersionIds.length) {
      await transaction
        .update(fileVersions)
        .set({ status: "indexed" })
        .where(inArray(fileVersions.id, indexedFileVersionIds));
    }
    await transaction
      .update(imports)
      .set({ status: "completed", completedAt: new Date(), errorMessage: null })
      .where(eq(imports.batchId, batchId));
    await transaction
      .update(indexSnapshots)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(indexSnapshots.id, batch.snapshotId));
    await transaction
      .update(importBatches)
      .set({ status: "completed", completedAt: new Date(), errorMessage: null })
      .where(eq(importBatches.id, batchId));
  });
}

/** 供 Workflow 将已经成功向量化的文本文件标记为候选快照就绪
 * 文件完成向量解析时候 step会调用这个保存文件ready状态
 */
export async function markImportReady(importId: string) {
  await getDatabase()
    .update(imports)
    .set({ status: "ready", errorMessage: null })
    .where(eq(imports.id, importId));
}

/** 记录一个可索引文件的具体失败，批次失败时保留其原始错误信息。 */
export async function markImportFailed(importId: string, message: string) {
  await getDatabase()
    .update(imports)
    .set({
      status: "failed",
      errorMessage: message.slice(0, 1_000),
      completedAt: new Date(),
    })
    .where(eq(imports.id, importId));
}

/** Workflow 启动时更新批次和所有待执行文件状态。 */
export async function markImportBatchRunning(batchId: string) {
  const db = getDatabase();
  await db.transaction(async (transaction) => {
    await transaction
      .update(importBatches)
      .set({ status: "running", errorMessage: null })
      .where(eq(importBatches.id, batchId));
    await transaction
      .update(imports)
      .set({ status: "running", errorMessage: null })
      .where(and(eq(imports.batchId, batchId), eq(imports.status, "queued")));
  });
}

/** 记录候选批次失败，不改变当前已经发布的快照。 */
export async function markBatchFailed(batchId: string, message: string) {
  const db = getDatabase();
  await db.transaction(async (transaction) => {
    await transaction
      .update(importBatches)
      .set({
        status: "failed",
        errorMessage: message.slice(0, 1_000),
        completedAt: new Date(),
      })
      .where(eq(importBatches.id, batchId));
    await transaction
      .update(imports)
      .set({
        status: "failed",
        errorMessage: message.slice(0, 1_000),
        completedAt: new Date(),
      })
      .where(
        and(
          eq(imports.batchId, batchId),
          ne(imports.status, "completed"),
          ne(imports.status, "failed"),
        ),
      );
  });
}

/** 原始文件写入失败时标记整批失败，避免出现无法读取的候选快照。 */
async function markBatchStorageFailed(batchId: string) {
  await markBatchFailed(batchId, "Failed to store the uploaded file.");
}
