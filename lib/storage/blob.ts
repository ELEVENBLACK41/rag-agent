/**
 * 修改时间：2026-09-07 | 文件说明：VaultAgent Vercel 私有 Blob 文件存储 | edit by：Sliye
 */

import { Buffer } from "node:buffer";
import { del, get, put } from "@vercel/blob";

/** 私有知识库文件的浏览器缓存策略：不落盘，仅允许本次服务端读取。 */
const PRIVATE_BLOB_CACHE_SECONDS = 60;

/**
 * 将原始文件写入 Vercel 私有 Blob。
 * 官方文档：https://vercel.com/docs/vercel-blob/private-storage
 *
 * @param storageKey 服务端生成的 Blob 路径，不包含用户原始文件名。
 * @param bytes 待保存的原始文件字节。
 */
export async function writePrivateBlob(storageKey: string, bytes: Uint8Array) {
  await put(storageKey, Buffer.from(bytes), {
    access: "private",
    addRandomSuffix: false,
    cacheControlMaxAge: PRIVATE_BLOB_CACHE_SECONDS,
  });
}

/**
 * 从 Vercel 私有 Blob 读取原始文件字节。
 *
 * @param storageKey 服务端生成的 Blob 路径。
 */
export async function readPrivateBlob(storageKey: string) {
  const result = await get(storageKey, { access: "private" });
  if (!result || result.statusCode !== 200) {
    throw new Error("Private Blob file does not exist.");
  }

  return new Uint8Array(await new Response(result.stream).arrayBuffer());
}

/**
 * 删除 Vercel 私有 Blob 中的原始文件。
 *
 * @param storageKey 服务端生成的 Blob 路径。
 */
export async function deletePrivateBlob(storageKey: string) {
  await del(storageKey);
}
