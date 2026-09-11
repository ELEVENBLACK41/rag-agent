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
    /**
     * 创建原文定位信息
     * 从正文提取MD链接
     * Obsidian Wiki链接
     * 附件链接
     * Obsidian Block ID
     * 标题路径
     */
    const sourceLocator = createSourceLocator(body, headingPath);

    //如果内容超过1400字符，会按固定字符数切割
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

  //遍历markdown每一行，数组下标从零开始，但是文件行号从1开始所以加1
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    //标题识别
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    //遇到标题得时候先提交旧得段落，如果遇到标题前累计了正文，那么先提交正文
    if (headingMatch) {
      flush(lineNumber - 1);
      //维护标题栈
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

/** 从一个文本块中提取 Obsidian Block ID、wiki 链接与 Markdown 链接。
 * 函数主要负责生成原文定位信息
 * 结果类似于
 * {
  format: "markdown",
  headingPath: ["产品文档", "安装说明"],
  blockIds: ["install-node"],
  links: ["docs/config.md", "https://example.com"],
  attachments: ["images/logo.png"],
  }

 */
function createSourceLocator(
  content: string,
  headingPath: string[],
): SourceLocator {
  //Set去重
  const links = new Set<string>();
  const attachments = new Set<string>();
  //统一处理链接目标的内部函数
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


/**
 * 目前 该md解析器是一个很简单的解析器，其主要是用很低的实现成本来提取md中对检索最有价值的结构化信息
 * 后续迭代会持续迭代  AST(理解 Markdown 的结构，再进行业务处理，复杂场景更可靠)
 */
