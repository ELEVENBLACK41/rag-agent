/**
 * 修改时间：2026-09-16 | 文件说明：会话问答创建、Workflow 派发与请求校验 | edit by：Sliye
 */

import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { createChatRun } from "@/lib/chat/run-store";
import { failChatRun } from "@/lib/chat/run-lifecycle";
import { chatRunWorkflow } from "@/workflows/chat-run";
import { start } from "workflow/api";
import { z } from "zod";

/** 入口一次解析请求，后续仅传递已校验的问题与会话标识。 */
const chatRequestSchema = z.object({ question: z.string().trim().min(1).max(4_000), conversationId: z.string().uuid().nullish(), retryRunId: z.string().uuid().optional() });

export const runtime = "nodejs";
/** 创建与派发请求的函数时限；模型执行期限由聊天领域独立管理。 */
export const maxDuration = 120;

/**
 * 创建一次受限问答并返回可独立订阅的 Run。
 * 官方文档：https://nextjs.org/docs/app/building-your-application/routing/route-handlers
 *
 * @param request 包含问题和可选会话标识的 JSON 请求。
 */
export async function POST(request: Request) {
  if (!canAccessD3LocalFeature(request)) {
    return Response.json(
      { error: "Chat is unavailable in this deployment mode." },
      { status: 403 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = chatRequestSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: "问题须为 1 至 4000 字，会话标识必须有效。" }, { status: 400 });
  const { question, conversationId, retryRunId } = parsed.data;

  try {
    //调用核心逻辑 创建单轮Run
    const chatRun = await createChatRun(
      question,
      conversationId ?? undefined,
      retryRunId,
    );
    try {
      // 官方：https://useworkflow.dev/docs/api-reference/workflow-api/start；只派发持久任务，浏览器断开不取消执行。
      await start(chatRunWorkflow, [chatRun.runId]);
    } catch {
      await failChatRun(chatRun.runId, "后台任务派发失败，请主动重试。");
    }
    // 即使派发失败也返回已创建的 Run，让客户端查看终态并使用同一重试入口。
    return Response.json(chatRun, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to start the knowledge query.";
    return Response.json({ error: message }, { status: 400 });
  }
}
