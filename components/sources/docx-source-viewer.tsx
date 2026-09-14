/**
 * 修改时间：2026-09-14
 * 文件说明：VaultAgent DOCX 原文件的只读渲染与引用定位 Viewer。
 *
 * 浏览器只从当前 Run 的受鉴权地址读取原始字节。docx-preview 在组件销毁或切换
 * 来源时清空 DOM，引用高亮仅插入临时展示节点，不会写回 Word 文件或数据库。
 *
 * edit by：Sliye
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2Icon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import type { SourceHighlight } from "@/lib/sources/types";

type DocxSourceViewerProps = {
  fileUrl: string;
  highlight: SourceHighlight | null;
};

type ViewerStatus =
  | { kind: "loading" }
  | { kind: "ready"; location: "highlighted" | "not-found" }
  | { kind: "failed"; message: string };

/** 渲染原始 DOCX，并在渲染完成后尝试定位本次来源。 */
export function DocxSourceViewer({ fileUrl, highlight }: DocxSourceViewerProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<ViewerStatus>({ kind: "loading" });

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const controller = new AbortController();
    let isCurrent = true;
    container.replaceChildren();
    setStatus({ kind: "loading" });

    void renderDocxFile(fileUrl, container, controller.signal)
      .then(() => {
        if (!isCurrent) return;
        const location = highlightDocxSource(container, highlight) ? "highlighted" : "not-found";
        setStatus({ kind: "ready", location });
      })
      .catch((error: unknown) => {
        if (!isCurrent || (error instanceof DOMException && error.name === "AbortError")) return;
        setStatus({
          kind: "failed",
          message: error instanceof Error ? error.message : "DOCX 原文件无法渲染。",
        });
      });

    return () => {
      isCurrent = false;
      controller.abort();
      container.replaceChildren();
    };
  }, [fileUrl, highlight]);

  return (
    <section className="space-y-2" aria-label="DOCX 原文件预览">
      <DocxViewerStatus status={status} />
      <div className="overflow-auto rounded-lg border bg-muted/40 p-3">
        <div ref={contentRef} className="docx-source-viewer min-w-fit bg-card" />
      </div>
    </section>
  );
}

/** 获取私有 DOCX 字节，再动态加载 Viewer，避免 Office 解析依赖进入首屏聊天包。 */
async function renderDocxFile(fileUrl: string, container: HTMLElement, signal: AbortSignal) {
  const response = await fetch(fileUrl, { cache: "no-store", signal });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "无法读取原始 DOCX 文件。");
  }
  const bytes = await response.arrayBuffer();
  const { renderAsync } = await import("docx-preview");
  await renderAsync(bytes, container, undefined, {
    breakPages: true,
    inWrapper: false,
    renderAltChunks: false,
    renderComments: false,
    useBase64URL: true,
  });
  removeExternalDocxMedia(container);
}

/** DOCX 外链图片不自动请求，避免在来源预览时泄露浏览器访问时间和 IP。 */
function removeExternalDocxMedia(container: HTMLElement) {
  for (const image of container.querySelectorAll("img")) {
    if (!image.src.startsWith("data:")) image.remove();
  }
}

/** 定位文本或内嵌图片；旧索引缺少短引用时只报告未定位，不猜测错误位置。 */
function highlightDocxSource(container: HTMLElement, highlight: SourceHighlight | null) {
  if (highlight?.kind === "docx-text") return highlightDocxText(container, highlight.quote.exact);
  if (highlight?.kind === "docx-image" && highlight.imageIndex) return highlightDocxImage(container, highlight.imageIndex);
  return false;
}

/** 以原始短引用跨 Text Node 建立范围，适配 Word 将同一文本拆成多个样式节点的情况。 */
function highlightDocxText(container: HTMLElement, quote: string) {
  const range = findTextRange(container, quote);
  if (!range) return false;
  const marker = document.createElement("mark");
  marker.className = "bg-source-highlight rounded-sm px-0.5 text-foreground";
  marker.dataset.vaultagentSourceHighlight = "true";
  marker.append(range.extractContents());
  range.insertNode(marker);
  marker.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

/** DOCX 图片序号与视觉分析器共用出现顺序；只定位对应图片，不对邻近图片猜测。 */
function highlightDocxImage(container: HTMLElement, imageIndex: number) {
  const image = container.querySelectorAll("img").item(imageIndex - 1);
  if (!image) return false;
  image.classList.add("ring-2", "ring-source-highlight", "ring-offset-2");
  image.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

/** 在连续文本节点中寻找精确原文并生成可跨节点的 DOM Range。 */
function findTextRange(root: HTMLElement, quote: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let documentText = "";
  let node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
    documentText += node.textContent ?? "";
  }
  const startOffset = documentText.indexOf(quote);
  if (startOffset < 0) return null;
  const endOffset = startOffset + quote.length;
  let cursor = 0;
  let start: { node: Text; offset: number } | null = null;
  for (const textNode of nodes) {
    const nextCursor = cursor + (textNode.textContent?.length ?? 0);
    if (!start && startOffset >= cursor && startOffset < nextCursor)
      start = { node: textNode, offset: startOffset - cursor };
    if (start && endOffset > cursor && endOffset <= nextCursor) {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(textNode, endOffset - cursor);
      return range;
    }
    cursor = nextCursor;
  }
  return null;
}

/** 用明确状态区分加载、定位失败和渲染失败，避免把“原文已打开”伪装成定位成功。 */
function DocxViewerStatus({ status }: { status: ViewerStatus }) {
  if (status.kind === "loading")
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircleIcon className="size-4 animate-spin" />正在读取并渲染原始 DOCX…</p>;
  if (status.kind === "failed")
    return <p className="flex items-center gap-2 text-sm text-destructive" role="alert"><CircleAlertIcon className="size-4" />{status.message}</p>;
  if (status.location === "highlighted")
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2Icon className="size-4" />已定位并高亮本次引用。</p>;
  return <p className="flex items-center gap-2 text-sm text-muted-foreground"><CircleAlertIcon className="size-4" />原文件已打开，但当前索引没有可精确定位的引用。</p>;
}
