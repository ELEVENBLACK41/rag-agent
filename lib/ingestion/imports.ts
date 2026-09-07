/**
 * 修改时间：2026-09-07 | 文件说明：VaultAgent D2-D3 Markdown 导入任务创建与删除 | edit by：Sliye
 */

import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import {
  fileVersions,
  imports,
  indexSnapshots,
  logicalFiles,
  principals,
  workspaces,
} from "@/lib/db/schema";
import { createStorageKey, deleteStoredFile, writeStoredFile } from "@/lib/storage/files";

/** 本地开发模式下唯一的工作区标识。 */
export const LOCAL_WORKSPACE_ID = "local-default-workspace";
/** 本地开发模式下唯一的所有者标识。 */
export const LOCAL_OWNER_ID = "local-owner";

export type CreatedImport = {
  importId: string;
};

/** 在不暴露公开多租户入口的前提下，创建本地唯一工作区和所有者身份。 */
export async function ensureLocalPrincipal() {
  const db = getDatabase();

  await db.insert(workspaces).values({ id: LOCAL_WORKSPACE_ID, mode: "local" }).onConflictDoNothing();
  await db
    .insert(principals)
    .values({ id: LOCAL_OWNER_ID, workspaceId: LOCAL_WORKSPACE_ID, kind: "owner" })
    .onConflictDoNothing();
}

/**
 * 保存原始 Markdown、不可变版本记录和待执行导入任务。
 *
 * @param fileName 已校验扩展名的显示文件名。
 * @param bytes 已接收的原始 Markdown 字节。
 */
export async function createLocalMarkdownImport(
  fileName: string,
  bytes: Uint8Array,
): Promise<CreatedImport> {
  await ensureLocalPrincipal();

  const db = getDatabase();
  const logicalFileId = randomUUID();
  const fileVersionId = randomUUID();
  const snapshotId = randomUUID();
  const importId = randomUUID();
  const storageKey = createStorageKey(LOCAL_WORKSPACE_ID, fileVersionId);
  const contentHash = createHash("sha256").update(bytes).digest("hex");

  await db.transaction(async (transaction) => {
    await transaction.insert(logicalFiles).values({
      id: logicalFileId,
      workspaceId: LOCAL_WORKSPACE_ID,
      displayName: fileName,
    });
    await transaction.insert(fileVersions).values({
      id: fileVersionId,
      logicalFileId,
      versionNumber: 1,
      contentHash,
      mediaType: "text/markdown",
      byteSize: bytes.byteLength,
      storageKey,
      status: "queued",
    });
    await transaction.insert(indexSnapshots).values({
      id: snapshotId,
      workspaceId: LOCAL_WORKSPACE_ID,
      status: "building",
    });
    await transaction.insert(imports).values({
      id: importId,
      workspaceId: LOCAL_WORKSPACE_ID,
      fileVersionId,
      snapshotId,
      status: "queued",
    });
  });

  try {
    await writeStoredFile(storageKey, bytes);
  } catch (error) {
    await markImportStorageFailed(importId, fileVersionId);
    throw error;
  }

  return { importId };
}

/**
 * 读取导入的最小状态，浏览器轮询时不返回原始文件内容。
 *
 * @param importId 导入任务标识。
 */
export async function getLocalImportStatus(importId: string) {
  const [importRecord] = await getDatabase()
    .select({
      id: imports.id,
      status: imports.status,
      errorMessage: imports.errorMessage,
      completedAt: imports.completedAt,
    })
    .from(imports)
    .where(eq(imports.id, importId))
    .limit(1);

  return importRecord ?? null;
}

/**
 * 删除原始文件并撤销其索引快照，使后续检索不能再读取该文件内容。
 *
 * @param importId 导入任务标识。
 */
export async function deleteLocalImport(importId: string) {
  const db = getDatabase();
  const [importRecord] = await db
    .select({
      fileVersionId: imports.fileVersionId,
      snapshotId: imports.snapshotId,
      logicalFileId: fileVersions.logicalFileId,
      storageKey: fileVersions.storageKey,
    })
    .from(imports)
    .innerJoin(fileVersions, eq(imports.fileVersionId, fileVersions.id))
    .where(eq(imports.id, importId))
    .limit(1);

  if (!importRecord) return false;

  await deleteStoredFile(importRecord.storageKey);
  await db.transaction(async (transaction) => {
    await transaction
      .update(indexSnapshots)
      .set({ status: "deleted" })
      .where(eq(indexSnapshots.id, importRecord.snapshotId));
    await transaction
      .update(fileVersions)
      .set({ status: "deleted" })
      .where(eq(fileVersions.id, importRecord.fileVersionId));
    await transaction
      .update(logicalFiles)
      .set({ deletedAt: new Date() })
      .where(eq(logicalFiles.id, importRecord.logicalFileId));
    await transaction
      .update(imports)
      .set({ status: "deleted", completedAt: new Date() })
      .where(eq(imports.id, importId));
  });

  return true;
}

/**
 * 在原始文件无法写入时保留失败记录，避免留下看似可执行的导入任务。
 *
 * @param importId 导入任务标识。
 * @param fileVersionId 文件版本标识。
 */
async function markImportStorageFailed(importId: string, fileVersionId: string) {
  await getDatabase().transaction(async (transaction) => {
    await transaction
      .update(fileVersions)
      .set({ status: "failed" })
      .where(eq(fileVersions.id, fileVersionId));
    await transaction
      .update(imports)
      .set({
        status: "failed",
        errorMessage: "Failed to store the uploaded file.",
        completedAt: new Date(),
      })
      .where(eq(imports.id, importId));
  });
}

/**
 * 在成功调度后关联持久化 Workflow Run 标识。
 *
 * @param importId 导入任务标识。
 * @param workflowRunId Workflow SDK 返回的 Run 标识。
 */
export async function setImportWorkflowRun(importId: string, workflowRunId: string) {
  await getDatabase()
    .update(imports)
    .set({ workflowRunId })
    .where(eq(imports.id, importId));
}

/**
 * 记录调度失败，使任务状态可见且不删除用户数据。
 *
 * @param importId 导入任务标识。
 */
export async function recordImportDispatchError(importId: string) {
  await getDatabase()
    .update(imports)
    .set({
      status: "failed",
      errorMessage: "Workflow dispatch failed.",
      completedAt: new Date(),
    })
    .where(eq(imports.id, importId));
}
