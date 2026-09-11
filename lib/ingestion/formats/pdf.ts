/**
 * 修改时间：2026-09-11 | 文件说明：VaultAgent PDF 文本层解析器与物理页定位 | edit by：Sliye
 * 
 * 把一个PDF原始字节数组转换成统一的文本Chunk 和 页级别的判断，后面Workflow负责入库/向量化，聊天模块负责引用展示
 * PDF.js读取文档
 * 逐页生成文本层
 * 每页文本切成最多1400字符的Chunk
 * 每个Chunk绑定物理页码
 * 返回chunks + diagnostics
 */

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  ImportDiagnostic,
  ParsedDocument,
  ParsedTextChunk,
} from "@/lib/ingestion/formats/types";
import { getErrorMessage } from "@/lib/ingestion/errors";

/** 单个 PDF 页内文本块的最大字符数，避免一页过长撑大检索上下文。 */
const MAX_CHUNK_CHARACTERS = 1_400;

/**
 * 提取 PDF 文本层，并将每个文本块固定在单一物理页内。
 * PDF.js API：https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html
 *
 * @param bytes 已安全保存的 PDF 原始字节。
 */
export async function parsePdf(bytes: Uint8Array): Promise<ParsedDocument> {
  //用PDF.js打开字节流
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    stopAtErrors: false,//遇到某些 PDF 内部格式不规范时尽量继续解析
    useSystemFonts: true,//服务端环境下允许使用系统字体，减少标准字体相关警告
  });

  try {
    //成功后得到document其中有numPages
    const document = await loadingTask.promise;
    const chunks: ParsedTextChunk[] = [];
    const diagnostics: ImportDiagnostic[] = [];
    //然后按照物理页循环
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      try {
        const page = await document.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const pageText = toPageText(textContent.items);
        if (!pageText) {
          diagnostics.push({
            severity: "warning",
            stage: "parse",
            code: "no-text-layer",
            pageNumber,
            message: "该页没有可提取的文本层，尚未进行视觉分析。",
          });
          continue;
        }
        chunks.push(...splitPageText(pageText, pageNumber));
      } catch (error) {
        console.warn("[ingestion:pdf] page text extraction failed", {
          pageNumber,
          error: getErrorMessage(error, "Unknown PDF page extraction error."),
        });
        diagnostics.push({
          severity: "warning",
          stage: "parse",
          code: "text-extraction-failed",
          pageNumber,
          message: "该页文本层读取失败，未纳入本次索引。",
        });
      }
    }
    return { chunks, diagnostics };
  } catch (error) {
    console.error("[ingestion:pdf] document parse failed", {
      error: getErrorMessage(error, "Unknown PDF document parse error."),
    });
    throw new Error("PDF 无法解析。请确认文件未损坏且未加密。");
  } finally {
    await loadingTask.destroy();
  }
}

/** 将 PDF.js 文本项合并为自然段前的页内文本，保留其显式换行。 */
function toPageText(items: Array<unknown>) {
  let content = "";
  for (const item of items) {
    if (!isPdfTextItem(item) || !item.str) continue;
    content += item.str;
    content += item.hasEOL ? "\n" : " ";
  }
  return content.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

/** PDF.js 的 TextContent 同时包含文本项和结构标记，只有文本项可参与检索。 */
function isPdfTextItem(
  value: unknown,
): value is { str: string; hasEOL: boolean } {
  return (
    !!value &&
    typeof value === "object" &&
    "str" in value &&
    typeof value.str === "string" &&
    "hasEOL" in value &&
    typeof value.hasEOL === "boolean"
  );
}

/** 按自然空白优先切分单页文本，绝不让一个 Chunk 跨 PDF 页面。 */
function splitPageText(text: string, pageNumber: number): ParsedTextChunk[] {
  const chunks: ParsedTextChunk[] = [];
  let remaining = text;
  while (remaining.length) {
    const boundary = findChunkBoundary(remaining);
    const content = remaining.slice(0, boundary).trim();
    if (content) {
      chunks.push({
        content,
        startLine: null,
        endLine: null,
        sourceLocator: { format: "pdf", pageNumber },
      });
    }
    remaining = remaining.slice(boundary).trimStart();
  }
  return chunks;
}

/** 在字符上限内优先从空白处分割，避免截断普通词语。 */
function findChunkBoundary(text: string) {
  if (text.length <= MAX_CHUNK_CHARACTERS) return text.length;
  const whitespaceIndex = text.lastIndexOf(" ", MAX_CHUNK_CHARACTERS);
  return whitespaceIndex > MAX_CHUNK_CHARACTERS / 2
    ? whitespaceIndex
    : MAX_CHUNK_CHARACTERS;
}
