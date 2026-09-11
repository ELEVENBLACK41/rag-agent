/**
 * 修改时间：2026-09-10 | 文件说明：VaultAgent 可索引文本格式解析器注册表 | edit by：Sliye
 */

import { parseMarkdown } from "@/lib/ingestion/formats/markdown";
import { parsePlainText } from "@/lib/ingestion/formats/txt";

/** 已在当前阶段实现文本切块的 MIME 类型。 */
const TEXT_PARSERS = {
  "text/markdown": parseMarkdown,
  "text/plain": parsePlainText,
} as const;

/**
 * 按文件 MIME 类型调用对应格式解析器。PDF、Office 后续只需在此注册，不改 Workflow 编排。
 *
 * @param mediaType 文件版本保存的 MIME 类型。
 * @param content 已用 UTF-8 解码的文本内容。
 */
export function parseIndexableText(mediaType: string, content: string) {
  const parser = TEXT_PARSERS[mediaType as keyof typeof TEXT_PARSERS];
  if (!parser) throw new Error(`No text parser is registered for ${mediaType}.`);
  return parser(content);
}
