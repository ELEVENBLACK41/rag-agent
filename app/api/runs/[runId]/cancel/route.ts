/** 修改时间：2026-09-16 | 文件说明：受工作区约束的服务端主动取消入口 | edit by：Sliye */
import { z } from "zod";
import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { cancelChatRun } from "@/lib/chat/run-lifecycle";

/** @param request 同源主动停止请求。 @param context 路由提供的 Run ID。 */
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (!canAccessD3LocalFeature(request)) return Response.json({ error: "当前模式不允许取消问答。" }, { status: 403 });
  const parsed = z.string().uuid().safeParse((await context.params).runId);
  if (!parsed.success) return Response.json({ error: "无效 Run 标识。" }, { status: 400 });
  const status = await cancelChatRun(parsed.data);
  if (status === null) return Response.json({ error: "问答不存在或已删除。" }, { status: 404 });
  return Response.json({ status });
}
