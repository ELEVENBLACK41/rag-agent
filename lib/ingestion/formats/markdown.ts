/**
 * 修改时间：2026-09-10 | 文件说明：VaultAgent Markdown 格式解析器 | edit by：Sliye
 * 为Markdown单独服务的解析器，供 intake.ts 与 workflows/ingest-import-batch/steps.ts 共用
 * 按照标题和空行拆成段落
 * 补充标题和上下文
 * 按照1400字符切块
 * 提取标题，链接，附件，Obsidian Block ID，
 * 输出统一得ParsedTextChunk
 */

import type {
  ParsedTextChunk,
  SourceLocator,
} from "@/lib/ingestion/formats/types";

/** 单个文本块允许的最大字符数，超出时按连续字符拆分。 */
const MAX_CHUNK_CHARACTERS = 1_400;
/** 这个正则判断连接目标是不是附件 */
const ATTACHMENT_EXTENSION =
  /\.(?:png|jpe?g|gif|webp|pdf|docx|xlsx)(?:$|[?#])/i;

/**
 * 按标题与段落切分 Markdown，同时记录 Obsidian 可引用位置和相对链接。
 *
 * @param markdown 已通过 UTF-8 校验的 Markdown 正文字符串。
 */
export function parseMarkdown(markdown: string): ParsedTextChunk[] {
  const chunks: ParsedTextChunk[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  /** 
   * headingStack当前所在得标题层级
   * 例如：
   * # 产品文档
   * ## 安装说明
   * ### windows
   * 解析到windows得时候就是
   * [
   * { level: 1, text: "产品文档" },
   * { level: 2, text: "安装说明" },
   * { level: 3, text: "Windows" },
   * ]
   * 
   * */
  const headingStack: Array<{ level: number; text: string }> = [];
  //暂存当前段落的多行内容
  let paragraph: string[] = [];
  //记录当前段落开始的行号
  let startLine = 1;

  /** 将当前段落写入结果，并清空暂存内容。 */
  const flush = (endLine: number) => {
    const body = paragraph.join("\n").trim();
    paragraph = [];
    if (!body) return;

    const headingPath = headingStack.map((heading) => heading.text);
    const content = headingPath.length
      ? `${headingPath.at(-1)}\n\n${body}`
      : body;
    const sourceLocator = createSourceLocator(body, headingPath);
    for (
      let offset = 0;
      offset < content.length;
      offset += MAX_CHUNK_CHARACTERS
    ) {
      chunks.push({
        content: content.slice(offset, offset + MAX_CHUNK_CHARACTERS),
        startLine,
        endLine,
        sourceLocator,
      });
    }
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      flush(lineNumber - 1);
      const level = headingMatch[1].length;
      while (headingStack.length && headingStack.at(-1)!.level >= level)
        headingStack.pop();
      headingStack.push({ level, text: headingMatch[2] });
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

/** 从一个文本块中提取 Obsidian Block ID、wiki 链接与 Markdown 链接。 */
function createSourceLocator(
  content: string,
  headingPath: string[],
): SourceLocator {
  const links = new Set<string>();
  const attachments = new Set<string>();
  const addTarget = (target: string, isAttachment: boolean) => {
    const normalized = target.trim().replace(/^<|>$/g, "");
    if (!normalized || /^(?:https?:|mailto:)/i.test(normalized)) return;
    links.add(normalized);
    if (isAttachment || ATTACHMENT_EXTENSION.test(normalized))
      attachments.add(normalized);
  };

  for (const match of content.matchAll(
    /(!?)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g,
  )) {
    addTarget(match[2], match[1] === "!");
  }
  for (const match of content.matchAll(
    /(!?)\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g,
  )) {
    addTarget(match[2], match[1] === "!");
  }
  const blockIds = [
    ...content.matchAll(/(?:^|\s)\^([a-zA-Z0-9-]+)(?=\s|$)/gm),
  ].map((match) => match[1]);

  return {
    format: "markdown",
    headingPath,
    blockIds,
    links: [...links],
    attachments: [...attachments],
  };
}
