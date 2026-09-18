/** 修改时间：2026-09-17 | 文件说明：会话加载、联网选项、历史分页与聊天流生命周期 | edit by：Sliye */
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  replayMessageEvent,
  createAssistantMessage,
} from "@/lib/chat/message-state";
import {
  chatErrorMessage,
  subscribeChatRun,
  fetchConversation,
  readChatJson,
} from "@/components/chat/chat-client";
import type { ChatMessage, ChatRun } from "@/lib/chat/types";

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
  const pathname = usePathname();
  /** 区分尚未恢复与新会话，避免原生 URL 更新再次加载并打断当前流。 */
  const selectedConversationRef = useRef<string | null | undefined>(undefined);
  const [session, setSession] = useState<ChatSession>(EMPTY_SESSION);
  const [input, setInput] = useState("");
  /** 默认关闭；提交时保存到 Run，执行中的选项不随界面状态变化。 */
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "loading" | "older" | "streaming" | "deleting" | null
  >("loading");
  /** 同步阻止重复提交，React 状态提交前也不会开始第二个请求。 */
  const phaseRef = useRef<typeof phase>("loading");
  /** 每次切换递增，过期响应不得覆盖新会话。 */
  const requestRef = useRef(0);
  /** 主动取消与订阅 AbortController 独立；尚未拿到 Run ID 时记住停止请求。 */
  const activeRunRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  /** URL 路径只保存会话 ID；使用原生 History API 避免首次创建会话时打断回答流。
   * 官方文档：https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api
   * @param id 当前会话 ID；为空时返回新会话入口。
   * @param replace 首次创建会话时替换当前历史项。
   */
  const updateUrl = useCallback((id: string | null, replace = false) => {
    // 用户已转去知识库/审计时，后台拿到 Run ID 不能把路由抢回聊天。
    if (!/^\/chat(?:\/|$)/.test(window.location.pathname)) return;
    const url = id ? `/chat/${encodeURIComponent(id)}` : "/chat";
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
  }, []);

  /** 切换时立即清空旧内容；加载失败不能让旧会话消息出现在新会话下面。 */
  const selectConversation = useCallback(
    async (id: string | null, writeUrl = true) => {
      selectedConversationRef.current = id;
      controllerRef.current?.abort();
      activeRunRef.current = null;
      cancelRequestedRef.current = false;
      const controller = new AbortController();
      controllerRef.current = controller;
      const request = ++requestRef.current;
      phaseRef.current = id ? "loading" : null;
      setPhase(phaseRef.current);
      setSession({ ...EMPTY_SESSION, id });
      setInput("");
      setWebSearchEnabled(false);
      setError(null);
      if (writeUrl) updateUrl(id);
      if (!id) return;
      try {
        const history = await fetchConversation(id, controller.signal);
        if (request === requestRef.current) {
          setSession({
            id,
            title: history.conversation.title,
            messages: history.messages,
            nextBefore: history.nextBefore,
          });
          const active = history.messages.find(
            (message) =>
              message.role === "assistant" &&
              message.process?.status === "running",
          );
          if (active?.runId) {
            activeRunRef.current = active.runId;
            phaseRef.current = "streaming";
            setPhase("streaming");
            await subscribeChatRun(
              active.runId,
              active.lastSequence ?? 0,
              controller.signal,
              (event) => {
                if (request === requestRef.current)
                  setSession((current) => ({
                    ...current,
                    messages: current.messages.map((message) =>
                      message.id === active.id
                        ? replayMessageEvent(message, event)
                        : message,
                    ),
                  }));
              },
            );
          }
        }
      } catch (cause) {
        if (request === requestRef.current && !controller.signal.aborted)
          setError(chatErrorMessage(cause));
      } finally {
        if (request === requestRef.current) {
          activeRunRef.current = null;
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
      if (!/^\/chat(?:\/|$)/.test(pathname)) return;
      const match = pathname.match(/^\/chat\/([^/]+)\/?$/);
      const id = match ? decodeURIComponent(match[1]) : null;
      if (selectedConversationRef.current !== id)
        void selectConversation(id, false);
    };
    restore();
  }, [pathname, selectConversation]);

  /** 只有整个工作区卸载才释放订阅，页面切换不取消后台生成。 */
  const disconnect = useCallback(() => {
    selectedConversationRef.current = undefined;
    requestRef.current += 1;
    controllerRef.current?.abort();
  }, []);
  useEffect(() => disconnect, [disconnect]);

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

  /** @param text 当前问题。 @param retryRunId 主动重试时替换旧尝试，服务端校验原问题与归属。 */
  async function submitQuestion(text: string, retryRunId?: string) {
    const question = text.trim();
    if (!question || phaseRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestRef.current;
    const assistantId = crypto.randomUUID();
    activeRunRef.current = null;
    cancelRequestedRef.current = false;
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
    /** 当前请求和助手消息同时匹配，旧订阅不会覆盖新会话。 */
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
      const run = await readChatJson<ChatRun>(
        await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            conversationId: session.id,
            retryRunId,
            webSearchEnabled,
          }),
          signal: controller.signal,
        }),
      );
      if (request !== requestRef.current) return;
      activeRunRef.current = run.runId;
      selectedConversationRef.current = run.conversationId;
      updateUrl(run.conversationId, true);
      setSession((current) => ({
        ...current,
        id: run.conversationId,
        title: current.id ? current.title : question.slice(0, 60),
        messages: current.messages
          .filter((message) => !retryRunId || message.runId !== retryRunId)
          .map((message, index, all) =>
            index === all.length - 2
              ? { ...message, runId: run.runId }
              : message,
          ),
      }));
      updateAssistant((message) => ({ ...message, runId: run.runId }));
      void refreshDirectory();
      if (cancelRequestedRef.current) {
        try {
          await cancelRun(run.runId);
        } catch (cause) {
          if (request === requestRef.current) setError(chatErrorMessage(cause));
        }
      }
      await subscribeChatRun(run.runId, 0, controller.signal, (record) => {
        updateAssistant((message) => replayMessageEvent(message, record));
      });
    } catch (cause) {
      if (!controller.signal.aborted)
        updateAssistant((message) => ({
          ...message,
          error: activeRunRef.current
            ? "连接中断，后台可能仍在执行。刷新当前会话可继续接收。"
            : chatErrorMessage(cause),
          process: message.process
            ? { ...message.process, status: "interrupted", open: true }
            : undefined,
        }));
    } finally {
      if (request === requestRef.current) {
        controllerRef.current = null;
        activeRunRef.current = null;
        phaseRef.current = null;
        setPhase(null);
        void refreshDirectory();
      }
    }
  }

  /** @param runId 已创建的尝试。取消失败不伪造已停止，保留订阅以接收真实状态。 */
  async function cancelRun(runId: string) {
    await readChatJson(
      await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
      }),
    );
  }

  /** 主动停止写入服务端；切换或卸载仅断开订阅。 */
  async function stop() {
    cancelRequestedRef.current = true;
    if (!activeRunRef.current) return;
    const request = requestRef.current;
    try {
      await cancelRun(activeRunRef.current);
    } catch (cause) {
      if (request === requestRef.current) setError(chatErrorMessage(cause));
    }
  }

  /** @param runId 旧尝试，使用已保存的原问题创建新 Run。 */
  async function retry(runId: string) {
    const user = session.messages.find(
      (message) => message.runId === runId && message.role === "user",
    );
    if (user) await submitQuestion(user.content, runId);
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
    webSearchEnabled,
    setWebSearchEnabled,
    error,
    phase,
    submitQuestion,
    selectConversation,
    loadOlder,
    removeConversation,
    stop,
    retry,
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
