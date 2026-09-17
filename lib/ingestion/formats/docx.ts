/**
 * 修改时间：2026-09-18
 * 文件说明：VaultAgent 常规 DOCX 正文、列表、标题与基础表格解析器。
 *
 * Mammoth 负责安全地读取 DOCX 容器并映射 Word 常见样式；本文件仅把稳定的
 * HTML 结构收敛为检索 Chunk 和文档内位置。复杂版式、批注、文本框和精确分页
 * 不在当前支持范围内，避免把 HTML 展示结果误当成 Word 的像素级还原。
 *
 * edit by：Sliye
 */

import mammoth from "mammoth";
import type { ParsedDocument, ParsedTextChunk } from "@/lib/ingestion/formats/types";

/** 单个 DOCX 检索块最大字符数，与 Markdown/PDF 的上下文上限保持一致。 */
import { MAX_CHUNK_CHARACTERS } from "@/lib/ingestion/formats/chunking-config";

/**
 * 将常规 DOCX 转为标题路径、段落与基础表格 Chunk。
 * Mammoth 文档：https://github.com/mwilliamson/mammoth.js
 *
 * @param bytes 已安全保存的 DOCX 原始字节。
 */
export async function parseDocx(bytes: Uint8Array): Promise<ParsedDocument> {
  let result: Awaited<ReturnType<typeof mammoth.convertToHtml>>;
  try {
    result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes) },
      {
        externalFileAccess: false,
        /** Word 的 Title 样式属于文档结构，按一级标题与后续段落共同参与检索。 */
        styleMap: ["p[style-name='Title'] => h1:fresh"],
      },
    );
  } catch {
    throw new Error("DOCX 无法解析。请确认文件未损坏且不是受密码保护的旧版 Word 文档。");
  }
  return {
    chunks: parseDocxHtml(result.value),
    diagnostics: result.messages.map((message) => ({
      severity: "warning",
      stage: "parse",
      code: "document-conversion-warning",
      message: `DOCX 转换提示：${message.message}`,
    })),
  };
}

/**
 * 按 Mammoth 的块级 HTML 输出顺序建立可引用的正文和表格块。
 * Word 自动编号、项目符号会被 Mammoth 转为 li；它们常用于论文目录，必须参与索引。
 */
function parseDocxHtml(html: string): ParsedTextChunk[] {
  const chunks: ParsedTextChunk[] = [];
  const headingStack: Array<{ level: number; text: string }> = [];
  let blockIndex = 0;
  let tableIndex = 0;
  const contentWithTableTokens = html.replace(
    /<table\b[^>]*>[\s\S]*?<\/table>/gi,
    (tableHtml) => {
      tableIndex += 1;
      return `<vaultagent-table data-table-index="${tableIndex}">${tableToText(tableHtml)}</vaultagent-table>`;
    },
  );

  for (const match of contentWithTableTokens.matchAll(
    /<(h[1-6]|p|li|vaultagent-table)\b[^>]*>([\s\S]*?)<\/\1>/gi,
  )) {
    const tag = match[1].toLowerCase();
    const text = htmlToPlainText(match[2]);
    if (!text) continue;
    if (tag.startsWith("h")) {
      const level = Number(tag.slice(1));
      while (headingStack.length && headingStack.at(-1)!.level >= level)
        headingStack.pop();
      headingStack.push({ level, text });
      continue;
    }

    blockIndex += 1;
    const blockType = tag === "vaultagent-table" ? "table" : "paragraph";
    const tableMatch = /data-table-index="(\d+)"/i.exec(match[0]);
    for (let offset = 0; offset < text.length; offset += MAX_CHUNK_CHARACTERS) {
      const sourceText = text.slice(offset, offset + MAX_CHUNK_CHARACTERS);
      chunks.push({
        content: withHeadingContext(sourceText, headingStack),
        startLine: null,
        endLine: null,
        sourceLocator: {
          format: "docx",
          headingPath: headingStack.map((heading) => heading.text),
          blockType,
          blockIndex,
          ...(tableMatch ? { tableIndex: Number(tableMatch[1]) } : {}),
          textQuote: { exact: sourceText },
        },
      });
    }
  }
  return chunks;
}

/** 把基础 Word 表格保留为行列分隔的文本，避免丢失单元格之间的关系。 */
function tableToText(tableHtml: string) {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => {
    const cells = [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map((cell) => htmlToPlainText(cell[1]));
    return cells.filter(Boolean).join(" | ");
  });
  return rows.filter(Boolean).join("\n");
}

/** 清除 Mammoth 展示标签并解码常见实体，保留段落和单元格中的可检索文字。 */
function htmlToPlainText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

/** 给正文加入最近标题，提升短段落的检索语义且不改变其实际定位。 */
function withHeadingContext(
  content: string,
  headingStack: Array<{ level: number; text: string }>,
) {
  const heading = headingStack.at(-1)?.text;
  return heading && !content.startsWith(heading) ? `${heading}\n\n${content}` : content;
}

/** DOCX 常见文字实体的最小解码，不额外引入 HTML 解析依赖。 */
function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}
