/**
 * 修改时间：2026-09-07 | 文件说明：VaultAgent D3 会话删除 API | edit by：Sliye
 */

import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { deleteConversation } from "@/lib/chat/runs";

export const runtime = "nodejs";

/**
 * 软删除一个会话，不影响已导入知识库文件。
 *
 * @param request 发起删除的 HTTP 请求。
 * @param context Next.js 提供的动态路由参数。
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  if (!canAccessD3LocalFeature(request)) {
    return Response.json({ error: "Conversation deletion is unavailable in this deployment mode." }, { status: 403 });
  }

  const { conversationId } = await context.params;
  const deleted = await deleteConversation(conversationId);
  if (!deleted) return Response.json({ error: "Conversation not found." }, { status: 404 });

  return Response.json({ conversationId, status: "deleted" });
}
