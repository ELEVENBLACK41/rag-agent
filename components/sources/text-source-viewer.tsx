/**
 * 修改时间：2026-09-14
 * 文件说明：VaultAgent TXT 原文件的行定位与临时引用高亮 Viewer。
 *
 * TXT 保留每一行的原始顺序；黄色引用高亮只作用于本次回答的行范围，关闭来源后
 * 组件卸载并清除已读取正文。
 *
 * edit by：Sliye
 */

"use client";

import { useEffect, useRef } from "react";
import { LoaderCircleIcon } from "lucide-react";
import type { SourceHighlight } from "@/lib/sources/types";
import { useSourceFileText } from "@/components/sources/use-source-file-text";

type TextSourceViewerProps = {
  fileUrl: string;
  highlight: SourceHighlight | null;
};

/** 展示完整 TXT 原文并滚动到引用行。 */
export function TextSourceViewer({ fileUrl, highlight }: TextSourceViewerProps) {
  const { content, error, status } = useSourceFileText(fileUrl);
  const targetLineRef = useRef<HTMLLIElement>(null);
  const lineRange = highlight?.kind === "line-range" ? highlight : null;

  useEffect(() => {
    if (status === "ready" && targetLineRef.current)
      targetLineRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [status, lineRange?.startLine]);

  if (status === "loading" || status === "idle") return <SourceFileLoading />;
  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;

  const lines = content?.replace(/\r\n/g, "\n").split("\n") ?? [];
  return (
    <ol className="overflow-x-auto rounded-lg border bg-muted/40 py-3 font-mono text-xs leading-6">
      {lines.map((line, index) => {
        const lineNumber = index + 1;
        const isHighlighted = Boolean(
          lineRange && lineNumber >= lineRange.startLine && lineNumber <= lineRange.endLine,
        );
        return (
          <li
            className={isHighlighted ? "bg-source-highlight px-3 text-foreground" : "px-3"}
            key={`${lineNumber}:${line}`}
            ref={isHighlighted && lineNumber === lineRange?.startLine ? targetLineRef : null}
          >
            <span className="mr-4 inline-block w-8 select-none text-right text-muted-foreground">{lineNumber}</span>
            <span className="whitespace-pre-wrap break-words">{line || " "}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** 文本原文件加载状态。 */
function SourceFileLoading() {
  return <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircleIcon className="size-4 animate-spin" />正在读取完整原文…</p>;
}
