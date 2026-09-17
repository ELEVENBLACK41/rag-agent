/**
 * 修改时间：2026-09-14
 * 文件说明：VaultAgent D9 原始来源文件的受鉴权流式读取 API。
 *
 * 请求先验证 Run 与 Chunk 的快照归属，再读取私有存储。PDF 支持单一 bytes
 * Range，方便浏览器定位物理页；不会将私有 Blob URL 或本地文件路径返回给浏览器。
 *
 * edit by：Sliye
 */

import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { readRunSourceFile } from "@/lib/sources/reader";

export const runtime = "nodejs";

/** 返回当前 Run 允许读取的原文件，PDF 浏览器预览可以按 Range 请求内容。 */
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string; chunkId: string }> },
) {
  if (!canAccessD3LocalFeature(request)) {
    return Response.json({ error: "Source file is unavailable in this deployment mode." }, { status: 403 });
  }

  const { runId, chunkId } = await context.params;
  const file = await readRunSourceFile(runId, chunkId);
  if (!file) return Response.json({ error: "来源文件不存在、已删除或无权读取。" }, { status: 404 });

  return createFileResponse(file.bytes, file.mediaType, request.headers.get("range"));
}

/** 构造支持单范围读取的私有文件响应，不接受多范围以保持实现和资源边界明确。 */
function createFileResponse(bytes: Uint8Array, mediaType: string, rangeHeader: string | null) {
  const totalBytes = bytes.byteLength;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Type": mediaType,
    "Content-Disposition": "inline",
  });
  if (!rangeHeader) {
    headers.set("Content-Length", String(totalBytes));
    return new Response(copyBytesToArrayBuffer(bytes), { headers });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return new Response(null, { status: 416, headers });
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : totalBytes - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= totalBytes)
    return new Response(null, { status: 416, headers });

  const resolvedEnd = Math.min(end, totalBytes - 1);
  const body = bytes.slice(start, resolvedEnd + 1);
  headers.set("Content-Length", String(body.byteLength));
  headers.set("Content-Range", `bytes ${start}-${resolvedEnd}/${totalBytes}`);
  return new Response(copyBytesToArrayBuffer(body), { status: 206, headers });
}

/** Response 的 Web 类型要求独立 ArrayBuffer，避免 Node Buffer 的共享底层存储泄漏。 */
function copyBytesToArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
