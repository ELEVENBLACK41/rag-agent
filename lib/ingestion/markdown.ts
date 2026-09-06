/**
 * 修改时间：2026-09-06 | 文件说明：VaultAgent D2 基础 Markdown 段落切块 | edit by：Sliye
 */

export type MarkdownChunk = {
  content: string;
  startLine: number;
  endLine: number;
};

/** 单个文本块允许的最大字符数，超出时按连续字符拆分。 */
const MAX_CHUNK_CHARACTERS = 1_400;

/**
 * 按标题与段落切分 Markdown，同时保留原始行号范围。
 *
 * @param markdown 已通过 UTF-8 校验的 Markdown 正文。
 */
export function chunkMarkdown(markdown: string): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let heading = "";
  let paragraph: string[] = [];
  let startLine = 1;

  /**
   * 将当前段落写入结果，并清空暂存内容。
   *
   * @param endLine 当前段落在原文中的结束行号。
   */
  const flush = (endLine: number) => {
    const body = paragraph.join("\n").trim();
    paragraph = [];

    if (!body) return;

    const content = heading ? `${heading}\n\n${body}` : body;
    for (let offset = 0; offset < content.length; offset += MAX_CHUNK_CHARACTERS) {
      chunks.push({
        content: content.slice(offset, offset + MAX_CHUNK_CHARACTERS),
        startLine,
        endLine,
      });
    }
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const isHeading = /^#{1,6}\s+\S/.test(line);

    if (isHeading) {
      flush(lineNumber - 1);
      heading = line.trim();
      startLine = lineNumber;
      return;
    }

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
