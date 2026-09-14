/**
 * 修改时间：2026-09-14 | 文件说明：VaultAgent D9 受限多步问答 SSE API | edit by：Sliye
 */

import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { createChatRun, executeChatRun } from "@/lib/chat/runs";

export const runtime = "nodejs";
/** D9 多步工具链的 SSE 连接上限，仍低于 Hobby 函数的单次执行限制。 */
export const maxDuration = 120;

/**
 * 创建一次受限多步知识问答并以 Server-Sent Events 返回真实进度与文本增量。
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

  const question =
    typeof payload === "object" && payload
      ? (payload as { question?: unknown }).question
      : null;
  const requestedConversationId =
    typeof payload === "object" && payload
      ? (payload as { conversationId?: unknown }).conversationId
      : null;
  const conversationId = requestedConversationId ?? null;
  if (
    typeof question !== "string" ||
    !question.trim() ||
    question.length > 4_000
  ) {
    return Response.json(
      { error: "Question must be between 1 and 4,000 characters." },
      { status: 400 },
    );
  }
  if (conversationId !== null && typeof conversationId !== "string") {
    return Response.json(
      { error: "conversationId must be a string when provided." },
      { status: 400 },
    );
  }

  try {
    //调用核心逻辑 创建单轮Run
    const chatRun = await createChatRun(
      question.trim(),
      conversationId ?? undefined,
    );
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        };

        try {
          send("run", chatRun);
          for await (const event of executeChatRun(chatRun, question.trim())) {
            send(event.type, event.data);
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "知识问答执行失败。";
          send("error", { message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to start the knowledge query.";
    return Response.json({ error: message }, { status: 400 });
  }
}
