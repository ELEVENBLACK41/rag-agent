/**
 * 修改时间：2026-09-14
 * 文件说明：VaultAgent D9 来源抽屉的受鉴权文本预览 API。
 *
 * API 仅返回 Run 固定快照中的一个 Chunk 及其稳定定位；原文件和派生图片继续
 * 使用同一 Run/Chunk 范围内的独立地址读取。
 *
 * edit by：Sliye
 */

import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { getRunSourceRecord } from "@/lib/sources/reader";
import { toSourceLocator } from "@/lib/ingestion/formats/types";
import { createDocxSourceHighlight, createTextSourceHighlight } from "@/lib/sources/source-highlight";

export const runtime = "nodejs";

/** 返回当前本地 Run 中一条来源的解析预览与受鉴权媒体地址。 */
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string; chunkId: string }> },
) {
  if (!canAccessD3LocalFeature(request)) {
    return Response.json({ error: "Source preview is unavailable in this deployment mode." }, { status: 403 });
  }

  const { runId, chunkId } = await context.params;
  const source = await getRunSourceRecord(runId, chunkId);
  if (!source) return Response.json({ error: "来源不存在、已删除或无权读取。" }, { status: 404 });
  const locator = toSourceLocator(source.sourceLocator);
  const basePath = `/api/runs/${encodeURIComponent(runId)}/sources/${encodeURIComponent(chunkId)}`;
  return Response.json(
    {
      chunkId: source.chunkId,
      displayName: source.displayName,
      mediaType: source.mediaType,
      content: source.content,
      startLine: source.startLine,
      endLine: source.endLine,
      sourceLocator: locator,
      sourceHighlight:
        createTextSourceHighlight(source.mediaType, source.startLine, source.endLine) ??
        createDocxSourceHighlight(locator),
      fileUrl: `${basePath}/file`,
      documentUrl: source.mediaType === "application/pdf" ? `${basePath}/file` : null,
      visualAssetUrl: locator?.format.endsWith("-visual") ? `${basePath}/asset` : null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
