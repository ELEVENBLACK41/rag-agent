/*
 * @Author: shaoliye shaoliye@fengmap.com
 * @Date: 2026-09-16 11:46:16
 * @LastEditors: shaoliye shaoliye@fengmap.com
 * @LastEditTime: 2026-09-16 13:42:22
 * @FilePath: \rag-agent\components\chat\chat-client.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
/** 修改时间：2026-09-16 | 文件说明：聊天客户端的 JSON 请求与 SSE 帧读取 | edit by：Sliye */
import type { ChatStreamEvent, ConversationHistory } from "@/lib/chat/types";

/** @param response 同源 API 响应。失败时使用服务端公开错误，不伪造空列表。 */
export async function readChatJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.error === "string" ? data.error : "请求失败，请重试。",
    );
  return data as T;
}

/** @param id 会话标识。 @param signal 切换会话或离开页面时终止过期请求。 @param before 向前分页游标。 */
export async function fetchConversation(
  id: string,
  signal: AbortSignal,
  before?: string,
) {
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  return readChatJson<ConversationHistory>(
    await fetch(`/api/conversations/${encodeURIComponent(id)}${query}`, {
      cache: "no-store",
      signal,
    }),
  );
}

/** @param stream API 的 SSE 响应体。 @param onEvent 每个完整公开事件的消费者。 */
export async function consumeChatStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  /** SSE 帧只在完整 JSON 数据到达后解析，支持网络分片和 CRLF。 */
  const dispatch = (frame: string) => {
    const type = frame.match(/^event:\s*(.+)$/m)?.[1].trim();
    if (
      !type ||
      ![
        "run",
        "stage",
        "tool",
        "delta",
        "answer-stage",
        "complete",
        "error",
      ].includes(type)
    )
      return;
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) onEvent({ type, data: JSON.parse(data) } as ChatStreamEvent);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = /\r?\n\r?\n/.exec(buffer);
      while (boundary) {
        dispatch(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        boundary = /\r?\n\r?\n/.exec(buffer);
      }
      if (done) break;
    }
    if (buffer.trim()) dispatch(buffer);
  } finally {
    reader.releaseLock();
  }
}

/** 仅返回可以展示的异常消息。 */
export function chatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}
