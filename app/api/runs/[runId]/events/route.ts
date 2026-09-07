/**
 * 修改时间：2026-09-07 | 文件说明：VaultAgent D3 Run 事件 SSE 补齐 API | edit by：Sliye
 */

import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { getRunEvents } from "@/lib/chat/runs";

export const runtime = "nodejs";

/**
 * 返回指定序号之后已持久化的 Run 事件，用于页面断线或刷新后的补齐。
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
  const afterSequence = Number.isSafeInteger(afterValue) && afterValue >= 0 ? afterValue : 0;
  const events = await getRunEvents(runId, afterSequence);
  const body = events
    .map((event) => `event: replay\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");

  return new Response(body, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
