/**
 * 修改时间：2026-09-17 | 文件说明：VaultAgent TXT 纯文本格式解析器 | edit by：Sliye
 */

import type { ParsedTextChunk } from "@/lib/ingestion/formats/types";

/** TXT 单块最大字符数，与 Markdown 保持同一检索载荷上限。 */
import { MAX_CHUNK_CHARACTERS } from "@/lib/ingestion/formats/chunking-config";

/**
 * 按空行切分纯文本并保留行号。TXT 没有标题或 Obsidian 语义，定位结构保持为空。
 *
 * @param text 已通过 UTF-8 校验的纯文本正文。
 */
export function parsePlainText(text: string): ParsedTextChunk[] {
  const chunks: ParsedTextChunk[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let startLine = 1;

  const flush = (endLine: number) => {
    const content = paragraph.join("\n").trim();
    paragraph = [];
    if (!content) return;
    for (let offset = 0; offset < content.length; offset += MAX_CHUNK_CHARACTERS) {
      chunks.push({
        content: content.slice(offset, offset + MAX_CHUNK_CHARACTERS),
        startLine,
        endLine,
        sourceLocator: {
          format: "plain-text",
          headingPath: [],
          blockIds: [],
          links: [],
          attachments: [],
        },
      });
    }
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (!line.trim()) {
      flush(lineNumber - 1);
      startLine = lineNumber + 1;
      return;
    }
    if (!paragraph.length) startLine = lineNumber;
    paragraph.push(line);
  });
  flush(lines.length);
  return chunks;
}
