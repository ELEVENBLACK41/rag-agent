/**
 * 修改时间：2026-09-16 | 文件说明：会话内多轮问答 SSE 入口与请求校验 | edit by：Sliye
 */

import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { createChatRun } from "@/lib/chat/run-store";
import { executeChatRun } from "@/lib/chat/runs";
import { z } from "zod";

/** 入口一次解析请求，后续仅传递已校验的问题与会话标识。 */
const chatRequestSchema = z.object({ question: z.string().trim().min(1).max(4_000), conversationId: z.string().min(1).max(64).nullish() });

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

  const parsed = chatRequestSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: "问题须为 1 至 4000 字，会话标识必须有效。" }, { status: 400 });
  const { question, conversationId } = parsed.data;

  try {
    //调用核心逻辑 创建单轮Run
    const chatRun = await createChatRun(
      question,
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
          for await (const event of executeChatRun(chatRun, question)) {
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
