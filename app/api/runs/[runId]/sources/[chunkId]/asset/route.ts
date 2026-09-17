/**
 * 修改时间：2026-09-14
 * 文件说明：VaultAgent D9 视觉来源派生图片的受鉴权读取 API。
 *
 * 仅返回与当前 Chunk、文件版本严格匹配且完成分析的派生图片；视觉结果不能通过
 * 文件版本 ID 或存储键直接访问。
 *
 * edit by：Sliye
 */

import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { readRunVisualAsset } from "@/lib/sources/reader";

export const runtime = "nodejs";

/** 返回当前视觉 Chunk 绑定的派生图片。 */
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string; chunkId: string }> },
) {
  if (!canAccessD3LocalFeature(request)) {
    return Response.json({ error: "Visual source is unavailable in this deployment mode." }, { status: 403 });
  }

  const { runId, chunkId } = await context.params;
  const asset = await readRunVisualAsset(runId, chunkId);
  if (!asset) return Response.json({ error: "视觉来源不存在、尚未完成或无权读取。" }, { status: 404 });

  return new Response(asset.bytes, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": asset.mediaType,
    },
  });
}
