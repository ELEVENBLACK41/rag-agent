/**
 * 修改时间：2026-09-06 | 文件说明：VaultAgent 本地 Markdown 导入任务创建 | edit by：Sliye
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
import { createStorageKey, writeLocalFile } from "@/lib/storage/local";

/** 本地开发模式下唯一的工作区标识。 */
const LOCAL_WORKSPACE_ID = "local-default-workspace";
/** 本地开发模式下唯一的所有者标识。 */
const LOCAL_OWNER_ID = "local-owner";

export type CreatedImport = {
  importId: string;
};

/** 在不暴露公开多租户入口的前提下，创建本地唯一工作区和所有者身份。 */
async function ensureLocalPrincipal() {
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
    await writeLocalFile(storageKey, bytes);
  } catch (error) {
    await markImportStorageFailed(importId, fileVersionId);
    throw error;
  }

  return { importId };
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
