/**
 * 修改时间：2026-09-14
 * 文件说明：VaultAgent Markdown 本地图片的受鉴权读取 API。
 *
 * 图片路径只在服务端按 Run 固定快照解析；浏览器传入的 target 不能访问本地路径、
 * 存储键或当前 Vault 中不属于该快照的文件。
 *
 * edit by：Sliye
 */

import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { readRunMarkdownAttachment } from "@/lib/sources/attachment-resolver";

export const runtime = "nodejs";

/** 返回当前 Markdown 来源允许展示的一张本地图片。 */
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string; chunkId: string }> },
) {
  if (!canAccessD3LocalFeature(request)) {
    return Response.json({ error: "Markdown attachment is unavailable in this deployment mode." }, { status: 403 });
  }

  const target = new URL(request.url).searchParams.get("path");
  if (!target) return Response.json({ error: "缺少 Markdown 图片路径。" }, { status: 400 });

  const { runId, chunkId } = await context.params;
  const attachment = await readRunMarkdownAttachment(runId, chunkId, target);
  if (attachment.kind === "invalid") return Response.json({ error: "Markdown 图片路径无效。" }, { status: 400 });
  if (attachment.kind === "ambiguous") return Response.json({ error: "Markdown 图片路径存在重名歧义。" }, { status: 409 });
  if (attachment.kind === "not-found") return Response.json({ error: "Markdown 图片不存在或无权读取。" }, { status: 404 });

  return new Response(copyBytesToArrayBuffer(attachment.bytes), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      "Content-Type": attachment.mediaType,
    },
  });
}

/** Response 需要独立 ArrayBuffer，避免 Node Buffer 的共享底层存储进入响应。 */
function copyBytesToArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
