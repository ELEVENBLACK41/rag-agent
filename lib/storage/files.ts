/**
 * 修改时间：2026-09-07 | 文件说明：VaultAgent 本地文件系统与私有 Blob 的统一存储入口 | edit by：Sliye
 */

import { deletePrivateBlob, readPrivateBlob, writePrivateBlob } from "@/lib/storage/blob";
import {
  createStorageKey,
  deleteLocalFile,
  readLocalFile,
  writeLocalFile,
} from "@/lib/storage/local";

/** 支持的原始文件存储实现。 */
type StorageProvider = "filesystem" | "blob";

/**
 * 根据部署环境读取存储实现。未配置时保持 D2 的本地文件系统行为。
 */
function getStorageProvider(): StorageProvider {
  const provider = process.env.STORAGE_PROVIDER ?? "filesystem";
  if (provider === "filesystem" || provider === "blob") return provider;
  throw new Error("STORAGE_PROVIDER must be filesystem or blob.");
}

export { createStorageKey };

/**
 * 写入原始文件，调用者无需了解本地卷或私有 Blob 的差异。
 *
 * @param storageKey 服务端生成的存储键。
 * @param bytes 待保存的原始文件字节。
 */
export async function writeStoredFile(storageKey: string, bytes: Uint8Array) {
  if (getStorageProvider() === "blob") {
    await writePrivateBlob(storageKey, bytes);
    return;
  }

  await writeLocalFile(storageKey, bytes);
}

/**
 * 读取原始文件，供后台 Workflow 解析。
 *
 * @param storageKey 服务端生成的存储键。
 */
export async function readStoredFile(storageKey: string) {
  if (getStorageProvider() === "blob") return readPrivateBlob(storageKey);
  return readLocalFile(storageKey);
}

/**
 * 删除原始文件，删除失败时不更改业务数据库状态。
 *
 * @param storageKey 服务端生成的存储键。
 */
export async function deleteStoredFile(storageKey: string) {
  if (getStorageProvider() === "blob") {
    await deletePrivateBlob(storageKey);
    return;
  }

  await deleteLocalFile(storageKey);
}
