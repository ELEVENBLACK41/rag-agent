/**
 * 修改时间：2026-09-07 | 文件说明：VaultAgent D3 导入状态查询与删除 API | edit by：Sliye
 */

import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import {
  deleteLocalImport,
  getLocalImportBatchStatus,
} from "@/lib/ingestion/imports";

export const runtime = "nodejs";

/**
 * 获取一个导入任务的可公开状态，不返回原始文件与文本块内容。
 *
 * @param request 查询导入状态的 HTTP 请求。
 * @param context Next.js 提供的动态路由参数。
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ importId: string }> },
) {
  if (!canAccessD3LocalFeature(request)) {
    return Response.json(
      { error: "Import status is unavailable in this deployment mode." },
      { status: 403 },
    );
  }

  const { importId } = await context.params;
  const importRecord = await getLocalImportBatchStatus(importId);
  if (!importRecord)
    return Response.json({ error: "Import batch not found." }, { status: 404 });

  return Response.json(importRecord);
}

/**
 * 删除一个 D3 导入的原始文件与索引可见性。
 *
 * @param request 发起删除的 HTTP 请求。
 * @param context Next.js 提供的动态路由参数。
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ importId: string }> },
) {
  if (!canAccessD3LocalFeature(request)) {
    return Response.json(
      { error: "Import deletion is unavailable in this deployment mode." },
      { status: 403 },
    );
  }

  const { importId } = await context.params;
  const deleted = await deleteLocalImport(importId);
  if (!deleted)
    return Response.json({ error: "Import not found." }, { status: 404 });

  return Response.json({ importId, status: "deleted" });
}
