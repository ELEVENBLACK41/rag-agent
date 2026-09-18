/**
 * 修改时间：2026-09-14
 * 文件说明：VaultAgent 来源 Viewer 的展示定位转换。
 *
 * SourceLocator 表达可复现的文件位置；本模块只把已知位置转换为客户端 Viewer
 * 可执行的最小高亮契约，不能以检索拼接后的 Chunk 内容伪造文本引用。
 *
 * edit by：Sliye
 */

import type { SourceLocator } from "@/lib/ingestion/formats/types";
import type { SourceHighlight } from "@/lib/sources/types";

/** 仅为 Markdown/TXT 构造可安全使用的行范围高亮。 */
export function createTextSourceHighlight(
  mediaType: string,
  startLine: number | null,
  endLine: number | null,
): SourceHighlight | null {
  if (
    (mediaType !== "text/markdown" && mediaType !== "text/plain") ||
    startLine === null ||
    endLine === null
  ) return null;

  return { kind: "line-range", startLine, endLine };
}

/** 从已持久化的 DOCX 定位信息构造 Viewer 高亮，不对旧索引猜测原文。 */
export function createDocxSourceHighlight(locator: SourceLocator | null): SourceHighlight | null {
  if (locator?.format === "docx" && locator.textQuote)
    return {
      kind: "docx-text",
      blockIndex: locator.blockIndex,
      quote: locator.textQuote,
    };
  if (locator?.format === "docx-visual")
    return { kind: "docx-image", imageIndex: locator.imageIndex };
  return null;
}
