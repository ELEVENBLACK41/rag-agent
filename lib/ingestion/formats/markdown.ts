/**
 * 修改时间：2026-09-13
 * 文件说明：VaultAgent Markdown 结构感知解析器。
 *
 * DAY8 保留标题路径、段落、Obsidian 引用语义，并将 fenced code block 作为独立的
 * 可定位块。该实现不把代码中的 # 或空行误判为 Markdown 文档结构。
 * DAY8 重新升级了一下md文档的解析器，原来的解析器只适合简单文本，无法处理obs知识库里面md文档最重要的两类结构，标题层级和上下文，fenced code block （代码块）
 * 又因为md解析结果会进入Chunk，Embedding，关键词检索，RRF，rerank到最终回答，所以解析错误会导致检索错  引用错  回答错
 * 比如说就会误识别代码块中的标题 
 * 所以本质上加入rerank后重构一下md解析器，从按照标题和空行切字符串，升级为 识别标题，段落，代码块，并保留来源定位的轻量结构解析器
 * edit by：Sliye
 */

import type {
  ParsedTextChunk,
  SourceLocator,
} from "@/lib/ingestion/formats/types";

/** 单个文本块允许的最大字符数，避免长段落或代码撑大后续检索上下文。 */
const MAX_CHUNK_CHARACTERS = 1_400;
/** 判断链接目标是否为附件。 */
const ATTACHMENT_EXTENSION =
  /\.(?:png|jpe?g|gif|webp|pdf|docx|xlsx)(?:$|[?#])/i;
/** 判断这是正文还是代码块 */
type MarkdownBlock = {
  kind: "paragraph" | "code";
  content: string;
  startLine: number;
  endLine: number;
  codeLanguage?: string;
};

/**
 * 按标题、段落与 fenced code block 切分 Markdown，并记录可复现的 Obsidian 位置。
 *
 * @param markdown 已通过 UTF-8 校验的 Markdown 正文字符串。
 */
export function parseMarkdown(markdown: string): ParsedTextChunk[] {
  const chunks: ParsedTextChunk[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const headingStack: Array<{ level: number; text: string }> = [];
  let paragraphLines: string[] = [];
  let paragraphStartLine = 1;
  let codeLines: string[] = [];
  let codeStartLine = 1;
  let codeFence = "";
  let codeLanguage: string | undefined;

  const appendBlock = (block: MarkdownBlock) => {
    /**
     * 标题路径改成完整路径
     * 例如 # 部署文档
            ## Docker 部署
            ### Windows
            Chunk会包含  标题路径：部署文档 > Docker 部署 > Windows
     *  */ 
    const headingPath = headingStack.map((heading) => heading.text);
    const content = buildChunkContent(block, headingPath);
    const sourceLocator = createSourceLocator(
      block.content,
      headingPath,
      block.kind,
      block.codeLanguage,
    );
    appendSplitChunks(chunks, content, block, sourceLocator);
  };

  const flushParagraph = (endLine: number) => {
    const content = paragraphLines.join("\n").trim();
    paragraphLines = [];
    if (!content) return;
    appendBlock({
      kind: "paragraph",
      content,
      startLine: paragraphStartLine,
      endLine,
    });
  };

  const flushCode = (endLine: number) => {
    const content = codeLines.join("\n");
    codeLines = [];
    if (!content.trim()) return;
    appendBlock({
      kind: "code",
      content,
      startLine: codeStartLine,
      endLine,
      codeLanguage,
    });
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    /** 进入到代码块后里面的# 空行 普通文本 md符号都不会再被当成md结构去进行解析 */
    if (codeFence) {
      if (isClosingFence(line, codeFence)) {
        flushCode(lineNumber);
        codeFence = "";
        codeLanguage = undefined;
        return;
      }
      codeLines.push(line);
      return;
    }
    /** 代码块会被当成独立的chunk
     * 并保存为
     *   kind: "code",
     *   content: "const a = 1;",
     *   startLine: 5,
     *   endLine: 7,
     *   codeLanguage: "ts"
     */
    const openingFence = /^(`{3,}|~{3,})([^`]*)$/.exec(line);
    if (openingFence) {
      flushParagraph(lineNumber - 1);
      codeFence = openingFence[1];
      codeLanguage = openingFence[2].trim() || undefined;
      codeStartLine = lineNumber;
      return;
    }

    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      flushParagraph(lineNumber - 1);
      const level = headingMatch[1].length;
      while (headingStack.length && headingStack.at(-1)!.level >= level)
        headingStack.pop();
      headingStack.push({ level, text: headingMatch[2] });
      paragraphStartLine = lineNumber + 1;
      return;
    }

    if (!line.trim()) {
      flushParagraph(lineNumber - 1);
      paragraphStartLine = lineNumber + 1;
      return;
    }
    if (!paragraphLines.length) paragraphStartLine = lineNumber;
    paragraphLines.push(line);
  });

  if (codeFence) flushCode(lines.length);
  else flushParagraph(lines.length);
  return chunks;
}

/** 将完整标题路径和代码语言写入检索正文，不修改原文件的实际定位。 */
function buildChunkContent(block: MarkdownBlock, headingPath: string[]) {
  const context = headingPath.length ? `标题路径：${headingPath.join(" > ")}\n\n` : "";
  if (block.kind !== "code") return `${context}${block.content}`;
  const language = block.codeLanguage ? `代码语言：${block.codeLanguage}\n` : "";
  return `${context}${language}\`\`\`\n${block.content}\n\`\`\``;
}

/** 按行优先拆分长内容；每个分片都保留所属原始段落或代码块的位置。 */
function appendSplitChunks(
  chunks: ParsedTextChunk[],
  content: string,
  block: MarkdownBlock,
  sourceLocator: SourceLocator,
) {
  let remaining = content;
  while (remaining.length) {
    const boundary = findChunkBoundary(remaining);
    const part = remaining.slice(0, boundary).trim();
    if (part) {
      chunks.push({
        content: part,
        startLine: block.startLine,
        endLine: block.endLine,
        sourceLocator,
      });
    }
    remaining = remaining.slice(boundary).trimStart();
  }
}

/** 在限制内优先按换行或空白拆开，避免普通文本和代码标记被生硬截断
 * 长文本不再硬切 如果超过了 1400 字符的话 优先找合适的换行，找不到找空格还找不到，才硬切
 */
function findChunkBoundary(content: string) {
  if (content.length <= MAX_CHUNK_CHARACTERS) return content.length;
  const newlineBoundary = content.lastIndexOf("\n", MAX_CHUNK_CHARACTERS);
  if (newlineBoundary > MAX_CHUNK_CHARACTERS / 2) return newlineBoundary;
  const whitespaceBoundary = content.lastIndexOf(" ", MAX_CHUNK_CHARACTERS);
  return whitespaceBoundary > MAX_CHUNK_CHARACTERS / 2
    ? whitespaceBoundary
    : MAX_CHUNK_CHARACTERS;
}

/** fenced code block 必须以相同字符、且长度不少于开头围栏的行关闭 */
function isClosingFence(line: string, openingFence: string) {
  const marker = openingFence[0];
  const expression = new RegExp(`^${marker}{${openingFence.length},}\\s*$`);
  return expression.test(line);
}

/** 从一个 Markdown 块中提取 Obsidian Block ID、wiki 链接与 Markdown 链接。 */
function createSourceLocator(
  content: string,
  headingPath: string[],
  contentKind: "paragraph" | "code",
  codeLanguage?: string,
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
    contentKind,
    ...(codeLanguage ? { codeLanguage } : {}),
  };
}
