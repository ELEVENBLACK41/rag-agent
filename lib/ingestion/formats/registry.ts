/**
 * 修改时间：2026-09-11 | 文件说明：VaultAgent 可索引文档解析器注册表 | edit by：Sliye
 */

import { parseMarkdown } from "@/lib/ingestion/formats/markdown";
import { parsePdf } from "@/lib/ingestion/formats/pdf";
import { parsePlainText } from "@/lib/ingestion/formats/txt";
import type {
  ParsedDocument,
  ParsedTextChunk,
} from "@/lib/ingestion/formats/types";

type DocumentParser = (bytes: Uint8Array) => Promise<ParsedDocument>;

/** 已在当前阶段实现解析与切块的 MIME 类型。 */
const DOCUMENT_PARSERS: Record<string, DocumentParser> = {
  "text/markdown": (bytes) => parseUtf8Text(bytes, parseMarkdown),
  "text/plain": (bytes) => parseUtf8Text(bytes, parsePlainText),
  "application/pdf": parsePdf,
};

/**
 * 按文件 MIME 类型调用对应格式解析器。解析器接收原始字节，使二进制格式无需经过错误的 UTF-8 解码。
 *
 * @param mediaType 文件版本保存的 MIME 类型。
 * @param bytes 原始文件字节。
 */
export async function parseIndexableDocument(
  mediaType: string,
  bytes: Uint8Array,
): Promise<ParsedDocument> {
  const parser = DOCUMENT_PARSERS[mediaType];
  if (!parser) throw new Error(`No document parser is registered for ${mediaType}.`);
  return parser(bytes);
}

/** 以严格 UTF-8 解码文本格式，避免静默把损坏文件作为可检索正文。 */
async function parseUtf8Text(
  bytes: Uint8Array,
  parser: (text: string) => ParsedTextChunk[],
): Promise<ParsedDocument> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("文本文件不是有效的 UTF-8 编码或无法读取。");
  }
  return { chunks: parser(text), diagnostics: [] };
}
