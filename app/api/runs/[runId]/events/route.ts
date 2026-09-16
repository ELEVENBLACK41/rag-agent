/**
 * 修改时间：2026-09-16 | 文件说明：受会话访问范围约束的 Run 事件补齐 API | edit by：Sliye
 */

import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { z } from "zod";
import { createRunEventStream } from "@/lib/chat/run-event-stream";
import { getRunEvents } from "@/lib/chat/run-store";

export const runtime = "nodejs";
/** 持续连接覆盖 Run 的 120 秒期限，并为终态推送预留时间。 */
export const maxDuration = 150;

/**
 * 先补齐指定序号后的持久事件，再保持同一连接持续推送，直到终态或客户端断开。
 *
 * @param request 包含 after 查询参数的 HTTP 请求。
 * @param context Next.js 提供的动态路由参数。
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  if (!canAccessD3LocalFeature(request)) {
    return Response.json({ error: "Run events are unavailable in this deployment mode." }, { status: 403 });
  }

  const { runId } = await context.params;
  const afterValue = Number(new URL(request.url).searchParams.get("after") ?? "0");
  if (!z.string().uuid().safeParse(runId).success || !Number.isSafeInteger(afterValue) || afterValue < 0)
    return Response.json({ error: "无效 Run 标识或事件序号。" }, { status: 400 });
  const afterSequence = afterValue;
  const events = await getRunEvents(runId, afterSequence);
  if (!events) return Response.json({ error: "Run not found." }, { status: 404 });
  return new Response(createRunEventStream(runId, afterSequence, request.signal), {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
