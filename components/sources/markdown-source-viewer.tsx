/**
 * 修改时间：2026-09-16
 * 文件说明：VaultAgent Obsidian Markdown 原文件 Viewer。
 *
 * 复用 Streamdown 的代码、CJK、数学和 Mermaid 能力；本地图片统一转换为同一 Run
 * 快照内的受鉴权地址。原文只提取合法的单一背景色，不传递任意 HTML 样式。
 *
 * edit by：Sliye
 */

"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown, type Components } from "streamdown";
import { createMarkdownImageAttachments } from "@/components/sources/markdown-image-attachments";
import type { SourceHighlight } from "@/lib/sources/types";
import { useSourceFileText } from "@/components/sources/use-source-file-text";

type MarkdownSourceViewerProps = {
  attachmentUrl: string;
  fileUrl: string;
  highlight: SourceHighlight | null;
};

const streamdownPlugins = { cjk, code, math, mermaid };
const markdownComponents = { img: MarkdownImage, mark: MarkdownMark } as Components;
type MarkdownImageProps = React.ComponentProps<"img">;
type MarkdownMarkProps = React.ComponentProps<"mark"> & { "data-vaultagent-color"?: string };

/** 允许原文使用的单一 CSS 颜色值；不接受 URL、变量、分号或其他 CSS 声明。 */
const SOURCE_MARK_COLOR_PATTERN = /^(?:[a-z]+|#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\([^;{}]+\))$/i;

/** 渲染完整 Markdown，并在渲染完成后对本次回答引用执行临时文本高亮。 */
export function MarkdownSourceViewer({ attachmentUrl, fileUrl, highlight }: MarkdownSourceViewerProps) {
  const { content, error, status } = useSourceFileText(fileUrl);
  const contentRef = useRef<HTMLDivElement>(null);
  // 完成一次规范化md文档
  const markdown = useMemo(() => content ? normalizeObsidianMarkdown(content) : "", [content]);
  const imageAttachments = useMemo(
    () => createMarkdownImageAttachments(attachmentUrl),
    [attachmentUrl],
  );

  // 高亮逻辑
  useEffect(() => {
    if (!content || !contentRef.current || highlight?.kind !== "line-range") return;
    //根据行号找一段文本
    const quote = findLineQuote(content, highlight.startLine, highlight.endLine);
    if (!quote) return;
    // 等待 Markdown DOM 完成渲染
    const frame = requestAnimationFrame(() => highlightRenderedQuote(contentRef.current!, quote));
    return () => cancelAnimationFrame(frame);
  }, [content, highlight]);

  if (status === "loading" || status === "idle") return <SourceFileLoading />;
  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;

  return (
    <div ref={contentRef} className="rounded-lg border bg-card p-4">
      <Streamdown
        allowedTags={{ mark: ["data*"] }}
        className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        components={markdownComponents}
        linkSafety={{ enabled: true }}
        mode="static"
        plugins={streamdownPlugins}
        rehypePlugins={imageAttachments.rehypePlugins}
        urlTransform={imageAttachments.urlTransform}
      >
        {markdown}
      </Streamdown>
    </div>
  );
}

/** 不经过 Next 图片优化器，确保浏览器携带当前会话 Cookie 请求私有附件。 */
function MarkdownImage({ alt, src }: MarkdownImageProps) {
  if (typeof src !== "string" || !src.startsWith("/api/runs/")) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={typeof alt === "string" ? alt : "Markdown 本地图片"} className="max-w-full rounded-md border" src={src} />;
}

/** 渲染经校验的原文标记色；颜色值作为数据写入 CSS 变量，不写死在组件中。 */
function MarkdownMark({ children, "data-vaultagent-color": color }: MarkdownMarkProps) {
  const backgroundColor = decodeSourceMarkColor(color);
  if (!backgroundColor) return <>{children}</>;
  return (
    <mark
      className="rounded-sm bg-[var(--source-original-mark)] px-0.5 text-foreground"
      style={{ "--source-original-mark": backgroundColor } as CSSProperties}
    >
      {children}
    </mark>
  );
}

/** 将 Obsidian wiki 图片、==高亮== 与 mark 背景色转为受控的标准 Markdown/HTML。 */
function normalizeObsidianMarkdown(markdown: string) {
  let insideCodeFence = false;
  return markdown.split(/\r?\n/).map((line) => {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      insideCodeFence = !insideCodeFence;
      return line;
    }
    if (insideCodeFence) return line;
    const withWikiImages = line.replace(/!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g, (_match, target: string) => `![](<${target.trim()}>)`);
    const withSafeMarks = withWikiImages.replace(/<mark\b([^>]*)>/gi, (_match, attributes: string) => {
      const color = findSourceMarkColor(attributes);
      return color ? `<mark data-vaultagent-color="${encodeURIComponent(color)}">` : "<mark>";
    });
    return replaceObsidianHighlights(withSafeMarks);
  }).join("\n");
}

/** 从 mark 的 style 属性提取一个合法背景色，不向 Streamdown 传递原始 style。 */
function findSourceMarkColor(attributes: string) {
  const style = attributes.match(/\bstyle\s*=\s*(['"])(.*?)\1/i)?.[2];
  if (!style) return null;
  const color = style.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;{}]+)\s*;?/i)?.[1]?.trim();
  return color && SOURCE_MARK_COLOR_PATTERN.test(color) ? color : null;
}

/** 解码并再次校验保存在受控 data 属性中的原文颜色。 */
function decodeSourceMarkColor(value: string | undefined) {
  if (!value) return null;
  try {
    const color = decodeURIComponent(value);
    return SOURCE_MARK_COLOR_PATTERN.test(color) ? color : null;
  } catch {
    return null;
  }
}

/** 跳过 inline code，仅将 ==文本== 转换为经过白名单控制的 mark 标签。 */
function replaceObsidianHighlights(value: string) {
  return value.split(/(`[^`]*`)/g).map((part, index) => {
    if (index % 2) return part;
    return part.replace(
      /==([^=\n]+)==/g,
      `<mark data-vaultagent-color="${encodeURIComponent("yellow")}">$1</mark>`,
    );
  }).join("");
}

/** 从引用行范围选择一个渲染后可匹配的短文本，不使用检索追加的标题上下文
 * 找到引用范围内的原始行
 */
function findLineQuote(markdown: string, startLine: number, endLine: number) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines.slice(startLine - 1, endLine)) {
    // 剥掉md的语法
    const quote = line
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+|[-*+]\s+\[[ xX]\]\s+)/, "")
      .replace(/`{1,3}/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_~]/g, "")
      .trim();
    if (quote.length >= 2) return quote;
  }
  return null;
}

/** 跨渲染 Text Node 查找首个引用并以临时 mark 包裹，无法定位时不伪造成功。 */
function highlightRenderedQuote(root: HTMLElement, quote: string) {
  const range = findTextRange(root, quote);
  if (!range) return;
  const marker = document.createElement("mark");
  marker.dataset.vaultagentSourceHighlight = "true";
  marker.className = "bg-source-highlight rounded-sm px-0.5 text-foreground";
  marker.append(range.extractContents());
  range.insertNode(marker);
  // 滚动居中 主要是滚动到mark上
  marker.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** 构造一个允许跨内联 Text Node 的精确 DOM Range。 */
function findTextRange(root: HTMLElement, quote: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let text = "";
  let node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
    text += node.textContent ?? "";
  }
  const startOffset = text.indexOf(quote);
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

/** Markdown 原文件加载状态。 */
function SourceFileLoading() {
  return <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircleIcon className="size-4 animate-spin" />正在读取完整原文…</p>;
}
