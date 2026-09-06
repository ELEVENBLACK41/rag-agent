/**
 * 修改时间：2026-09-06 | 文件说明：VaultAgent 本地私有文件存储 | edit by：Sliye
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** 在不把上传文件名当作路径的前提下，解析本地私有数据目录。 */
function getDataDirectory() {
  return path.resolve(
    /* turbopackIgnore: true */ process.env.DATA_DIR ?? path.join(process.cwd(), "data"),
  );
}

/**
 * 将服务器生成的存储键解析为数据目录内的绝对路径。
 *
 * @param storageKey 由服务器生成的相对存储键。
 */
function resolveStoragePath(storageKey: string) {
  const dataDirectory = getDataDirectory();
  const target = path.resolve(dataDirectory, storageKey);
  const relativePath = path.relative(dataDirectory, target);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid local storage key.");
  }

  return target;
}

/**
 * 根据服务器生成的标识构造不含用户输入的存储键。
 *
 * @param workspaceId 工作区标识。
 * @param fileVersionId 文件版本标识。
 */
export function createStorageKey(workspaceId: string, fileVersionId: string) {
  return path.posix.join(workspaceId, "files", `${fileVersionId}.md`);
}

/**
 * 将原始上传字节写入配置的私有数据目录。
 *
 * @param storageKey 由服务器生成的相对存储键。
 * @param bytes 待保存的原始文件字节。
 */
export async function writeLocalFile(storageKey: string, bytes: Uint8Array) {
  const target = resolveStoragePath(storageKey);

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
}

/**
 * 通过服务器生成的存储键读取原始上传字节。
 *
 * @param storageKey 由服务器生成的相对存储键。
 */
export async function readLocalFile(storageKey: string) {
  const target = resolveStoragePath(storageKey);

  return readFile(/* turbopackIgnore: true */ target);
}
