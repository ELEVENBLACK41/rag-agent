/** 修改时间：2026-09-16 | 文件说明：当前会话加载、历史分页与聊天流的客户端生命周期 | edit by：Sliye */
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyChatEvent,
  createAssistantMessage,
} from "@/lib/chat/message-state";
import {
  chatErrorMessage,
  consumeChatStream,
  fetchConversation,
  readChatJson,
} from "@/components/chat/chat-client";
import type { ChatMessage } from "@/lib/chat/types";

type ChatSession = {
  id: string | null;
  title: string;
  messages: ChatMessage[];
  nextBefore: string | null;
};
/** 新会话只在首次提交时创建数据库记录。 */
const EMPTY_SESSION: ChatSession = {
  id: null,
  title: "新会话",
  messages: [],
  nextBefore: null,
};

/** @param refreshDirectory 会话创建、完成或删除后刷新侧栏。 */
export function useChatSession(refreshDirectory: () => Promise<void>) {
  const [session, setSession] = useState<ChatSession>(EMPTY_SESSION);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "loading" | "older" | "streaming" | "deleting" | null
  >("loading");
  /** 同步阻止重复提交，React 状态提交前也不会开始第二个请求。 */
  const phaseRef = useRef<typeof phase>("loading");
  /** 每次切换递增，过期响应不得覆盖新会话。 */
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  /** URL 路径只保存会话 ID；使用原生 History API 避免首次创建会话时打断回答流。
   * 官方文档：https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api
   * @param id 当前会话 ID；为空时返回新会话入口。
   * @param replace 首次创建会话时替换当前历史项。
   */
  const updateUrl = useCallback((id: string | null, replace = false) => {
    const url = id ? `/chat/${encodeURIComponent(id)}` : "/chat";
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
  }, []);

  /** 切换时立即清空旧内容；加载失败不能让旧会话消息出现在新会话下面。 */
  const selectConversation = useCallback(
    async (id: string | null, writeUrl = true) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const request = ++requestRef.current;
      phaseRef.current = id ? "loading" : null;
      setPhase(phaseRef.current);
      setSession({ ...EMPTY_SESSION, id });
      setInput("");
      setError(null);
      if (writeUrl) updateUrl(id);
      if (!id) return;
      try {
        const history = await fetchConversation(id, controller.signal);
        if (request === requestRef.current)
          setSession({
            id,
            title: history.conversation.title,
            messages: history.messages,
            nextBefore: history.nextBefore,
          });
      } catch (cause) {
        if (request === requestRef.current && !controller.signal.aborted)
          setError(chatErrorMessage(cause));
      } finally {
        if (request === requestRef.current) {
          phaseRef.current = null;
          setPhase(null);
        }
      }
    },
    [updateUrl],
  );

  useEffect(() => {
    const restore = () => {
      // 直接打开、刷新及前进/后退统一从动态路径恢复会话，不读取查询参数。
      const match = window.location.pathname.match(/^\/chat\/([^/]+)\/?$/);
      void selectConversation(
        match ? decodeURIComponent(match[1]) : null,
        false,
      );
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      controllerRef.current?.abort();
    };
  }, [selectConversation]);

  /** 同一会话向前加载完整问答；通过消息 ID 去重，不覆盖较新的消息。 */
  async function loadOlder() {
    if (!session.id || !session.nextBefore || phaseRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestRef.current;
    phaseRef.current = "older";
    setPhase("older");
    setError(null);
    try {
      const history = await fetchConversation(
        session.id,
        controller.signal,
        session.nextBefore,
      );
      if (request === requestRef.current)
        setSession((current) => ({
          ...current,
          nextBefore: history.nextBefore,
          messages: [
            ...new Map(
              [...history.messages, ...current.messages].map((message) => [
                message.id,
                message,
              ]),
            ).values(),
          ],
        }));
    } catch (cause) {
      if (request === requestRef.current && !controller.signal.aborted)
        setError(chatErrorMessage(cause));
    } finally {
      if (request === requestRef.current) {
        phaseRef.current = null;
        setPhase(null);
      }
    }
  }

  /** @param text 输入框的已提交内容；只发送当前问题，历史由服务端按会话范围读取。 */
  async function submitQuestion(text: string) {
    const question = text.trim();
    if (!question || phaseRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestRef.current;
    const assistantId = crypto.randomUUID();
    let conversationId = session.id;
    let completed = false;
    phaseRef.current = "streaming";
    setPhase("streaming");
    setInput("");
    setError(null);
    setSession((current) => ({
      ...current,
      messages: [
        ...current.messages,
        { id: crypto.randomUUID(), role: "user", content: question },
        createAssistantMessage(assistantId, Date.now()),
      ],
    }));
    /** 将更新限定到本次助手消息和当前请求，切换会话后忽略旧流。 */
    const updateAssistant = (update: (message: ChatMessage) => ChatMessage) => {
      if (request === requestRef.current)
        setSession((current) => ({
          ...current,
          messages: current.messages.map((message) =>
            message.id === assistantId ? update(message) : message,
          ),
        }));
    };
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, conversationId }),
        signal: controller.signal,
      });
      if (!response.ok) await readChatJson(response);
      if (!response.body) throw new Error("无法接收回答，请重试。");
      await consumeChatStream(response.body, (event) => {
        if (request !== requestRef.current) return;
        if (event.type === "run") {
          conversationId = event.data.conversationId;
          updateUrl(conversationId, true);
          setSession((current) => ({
            ...current,
            id: conversationId,
            title: current.id ? current.title : question.slice(0, 60),
          }));
          void refreshDirectory();
        }
        if (event.type === "complete") completed = true;
        updateAssistant((message) =>
          applyChatEvent(message, event, Date.now()),
        );
        if (event.type === "error") throw new Error(event.data.message);
      });
      if (!completed && conversationId && request === requestRef.current) {
        const history = await fetchConversation(
          conversationId,
          controller.signal,
        );
        if (request === requestRef.current)
          setSession({
            id: conversationId,
            title: history.conversation.title,
            messages: history.messages,
            nextBefore: history.nextBefore,
          });
      }
    } catch (cause) {
      const stopped = controller.signal.aborted;
      updateAssistant((message) => ({
        ...message,
        error: stopped
          ? "已停止接收回答。后台状态尚未确认，刷新可查看已保存进度。"
          : chatErrorMessage(cause),
        process: message.process
          ? {
              ...message.process,
              status: stopped ? "interrupted" : "failed",
              completedAt: Date.now(),
              open: true,
            }
          : undefined,
      }));
    } finally {
      if (request === requestRef.current) {
        controllerRef.current = null;
        phaseRef.current = null;
        setPhase(null);
        void refreshDirectory();
      }
    }
  }

  /** 仅删除当前会话；失败保留原消息供用户重试。 */
  async function removeConversation() {
    if (!session.id || phaseRef.current) return;
    const request = ++requestRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    phaseRef.current = "deleting";
    setPhase("deleting");
    setError(null);
    try {
      await readChatJson(
        await fetch(`/api/conversations/${encodeURIComponent(session.id)}`, {
          method: "DELETE",
          signal: controller.signal,
        }),
      );
      if (request === requestRef.current) {
        await selectConversation(null);
        void refreshDirectory();
      }
    } catch (cause) {
      if (request === requestRef.current && !controller.signal.aborted)
        setError(chatErrorMessage(cause));
    } finally {
      if (request === requestRef.current) {
        phaseRef.current = null;
        setPhase(null);
      }
    }
  }

  return {
    ...session,
    input,
    setInput,
    error,
    phase,
    submitQuestion,
    selectConversation,
    loadOlder,
    removeConversation,
    stop: () => controllerRef.current?.abort(),
    setProcessOpen: (id: string, open: boolean) =>
      setSession((current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.id === id && message.process
            ? { ...message, process: { ...message.process, open } }
            : message,
        ),
      })),
  };
}
