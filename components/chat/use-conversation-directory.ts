/** 修改时间：2026-09-16 | 文件说明：会话侧栏的分页加载与刷新状态 | edit by：Sliye */
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { chatErrorMessage, readChatJson } from "@/components/chat/chat-client";
import type { ConversationList } from "@/lib/chat/types";

/** 目录请求独立于聊天流；用序号淘汰较早的加载结果。 */
export function useConversationDirectory() {
  const [data, setData] = useState<ConversationList>({
    conversations: [],
    nextOffset: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  /** @param offset 为 0 时重新加载最近会话，否则追加下一页。 */
  const load = useCallback((offset: number) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestRef.current;
    return fetch(`/api/conversations?offset=${offset}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(readChatJson<ConversationList>)
      .then((page) => {
        if (request !== requestRef.current || controller.signal.aborted) return;
        setData((current) => ({
          nextOffset: page.nextOffset,
          conversations:
            offset === 0
              ? page.conversations
              : [
                  ...new Map(
                    [...current.conversations, ...page.conversations].map(
                      (item) => [item.id, item],
                    ),
                  ).values(),
                ],
        }));
      })
      .catch((cause: unknown) => {
        if (request === requestRef.current && !controller.signal.aborted)
          setError(chatErrorMessage(cause));
      })
      .finally(() => {
        if (request === requestRef.current && !controller.signal.aborted)
          setLoading(false);
      });
  }, []);
  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    return load(0);
  }, [load]);
  useEffect(() => {
    void load(0);
    return () => {
      controllerRef.current?.abort();
    };
  }, [load]);
  return {
    ...data,
    loading,
    error,
    refresh,
    loadMore: () => {
      if (!loading && data.nextOffset !== null) {
        setLoading(true);
        setError(null);
        void load(data.nextOffset);
      }
    },
  };
}
