/*
 * @Author: shaoliye shaoliye@fengmap.com
 * @Date: 2026-09-15 15:03:21
 * @LastEditors: shaoliye shaoliye@fengmap.com
 * @LastEditTime: 2026-09-16 13:35:22
 * @FilePath: \rag-agent\app\api\conversations\[conversationId]\route.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
/**
 * 修改时间：2026-09-16 | 文件说明：受工作区隔离的历史会话读取与删除 API | edit by：Sliye
 */

import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { deleteConversation } from "@/lib/chat/conversations";
import { getConversationHistory } from "@/lib/chat/conversation-history";
import { z } from "zod";

export const runtime = "nodejs";
/** 路由标识与可选分页游标在边界校验，不允许无界标识传入查询。 */
const historyQuerySchema = z.object({
  conversationId: z.string().min(1).max(64),
  before: z.string().min(1).max(64).optional(),
});

/** 按完整问答向前翻页，返回持久化消息及公开执行过程。 */
export async function GET(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  if (!canAccessD3LocalFeature(request))
    return Response.json(
      { error: "此环境不可访问聊天历史。" },
      { status: 403 },
    );
  const input = historyQuerySchema.safeParse({
    ...(await context.params),
    before: new URL(request.url).searchParams.get("before") ?? undefined,
  });
  if (!input.success)
    return Response.json({ error: "会话或分页参数无效。" }, { status: 400 });
  try {
    const history = await getConversationHistory(
      input.data.conversationId,
      input.data.before,
    );
    return history
      ? Response.json(history, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: "会话不存在或已经删除。" }, { status: 404 });
  } catch {
    return Response.json(
      { error: "无法读取历史消息，请重试。" },
      { status: 500 },
    );
  }
}

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
    return Response.json(
      {
        error: "Conversation deletion is unavailable in this deployment mode.",
      },
      { status: 403 },
    );
  }

  const { conversationId } = await context.params;
  const deleted = await deleteConversation(conversationId);
  if (!deleted)
    return Response.json({ error: "Conversation not found." }, { status: 404 });

  return Response.json({ conversationId, status: "deleted" });
}
