/**
 * 修改时间：2026-09-14
 * 文件说明：VaultAgent 来源原文件文本的客户端受鉴权读取 Hook。
 *
 * Hook 只读取服务端已授权的 fileUrl；切换引用、关闭 Viewer 或请求取消时立即中止，
 * 不在客户端长期保留上一份私有正文。
 *
 * edit by：Sliye
 */

"use client";

import { useEffect, useState } from "react";

type SourceFileTextState = {
  content: string | null;
  error: string | null;
  fileUrl: string | null;
  status: "idle" | "loading" | "ready" | "failed";
};

const INITIAL_STATE: SourceFileTextState = { content: null, error: null, fileUrl: null, status: "idle" };

/** 读取一个受鉴权的 Markdown/TXT 原文件，并在 URL 改变时清除旧正文。 */
export function useSourceFileText(fileUrl: string | null) {
  const [state, setState] = useState<SourceFileTextState>(INITIAL_STATE);

  useEffect(() => {
    if (!fileUrl) return;

    const controller = new AbortController();
    void fetchSourceText(fileUrl, controller.signal)
      .then((content) => setState({ content, error: null, fileUrl, status: "ready" }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          content: null,
          error: error instanceof Error ? error.message : "无法读取原始文件。",
          fileUrl,
          status: "failed",
        });
      });
    return () => controller.abort();
  }, [fileUrl]);

  if (state.fileUrl === fileUrl) return state;
  return fileUrl ? { content: null, error: null, fileUrl, status: "loading" as const } : INITIAL_STATE;
}

/** 以 no-store 读取当前 Run 已授权的文本原文件。 */
async function fetchSourceText(fileUrl: string, signal: AbortSignal) {
  const response = await fetch(fileUrl, { cache: "no-store", signal });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "无法读取原始文件。");
  }
  return response.text();
}
