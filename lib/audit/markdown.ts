/** 修改时间：2026-09-16 | 文件说明：从原始 Markdown 提取结构审计需要的引用、标题和 Block ID | edit by：Sliye */

import { AUDIT_LIMITS } from "@/lib/audit/types";

export type MarkdownReference = {
  target: string;
  line: number;
  wiki: boolean;
  embedded: boolean;
};
export type MarkdownStructure = {
  references: MarkdownReference[];
  anchors: Set<string>;
  unsupported: number;
};

/** 对标题文本归一化，同时保留中文；仅用于标题匹配，不用于文件路径。 */
export function normalizeHeading(value: string) {
  return value
    .replace(/[*_`~]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** 常用 Markdown 标题 URL slug；不能匹配的扩展语法会留给人工确认。 */
function headingSlug(value: string) {
  return normalizeHeading(value)
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/**
 * 读取原文而非检索块，保留空标题、锚点和精确引用行号；不让示例代码参与结构检查。
 * @param text 已按 UTF-8 解码的 Markdown 原文。
 */
export function inspectMarkdown(text: string): MarkdownStructure {
  const lines = maskNonProse(text).split("\n");
  const references: MarkdownReference[] = [];
  const anchors = new Set<string>();
  const definitions = new Map<string, string>();
  const slugCounts = new Map<string, number>();
  let unsupported = 0;
  const addHeading = (heading: string) => {
    anchors.add(normalizeHeading(heading));
    const slug = headingSlug(heading);
    const count = slugCounts.get(slug) ?? 0;
    anchors.add(count ? `${slug}-${count}` : slug);
    slugCounts.set(slug, count + 1);
  };

  for (const line of lines) {
    if (line.length > 20_000) continue;
    const definition = /^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/.exec(line);
    if (definition)
      definitions.set(
        definition[1].trim().toLowerCase(),
        definition[2] ?? definition[3],
      );
  }
  lines.forEach((line, index) => {
    if (line.length > 20_000 || references.length >= AUDIT_LIMITS.references) { unsupported++; return; }
    const heading = /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (heading) addHeading(heading[1]);
    if (index && /^ {0,3}(?:=+|-+)\s*$/.test(line) && lines[index - 1].trim())
      addHeading(lines[index - 1].trim());
    for (const block of line.matchAll(/(?:^|\s)\^([a-zA-Z0-9-]+)\s*$/g))
      anchors.add(`^${block[1]}`);
    if (/^ {0,3}\[[^\]]+\]:/.test(line)) return;
    // Wiki 的别名不属于目标，#标题和 #^block 必须保留。
    let rest = line.replace(/(`+)([^`]|(?!\1)`)*?\1/g, (match) => " ".repeat(match.length)).replace(/\\\[/g, "  ");
    rest = rest.replace(
      /(!?)\[\[([^\]\n]+)\]\]/g,
      (match, bang: string, target: string) => {
        references.push({
          target: target.split("|")[0].trim(),
          line: index + 1,
          wiki: true,
          embedded: Boolean(bang),
        });
        return " ".repeat(match.length);
      },
    );
    // 常规行内链接支持尖括号空格路径和一层括号；复杂/多行表达式不猜测解析。
    rest = rest.replace(
      /(!?)\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|((?:[^\s()\\]|\\.|\([^()\n]*\))*))(?:\s+["'][^\n]*?["'])?\s*\)/g,
      (
        match,
        bang: string,
        bracket: string | undefined,
        target: string | undefined,
      ) => {
        references.push({
          target: (bracket ?? target ?? "").replace(/\\([()])/g, "$1"),
          line: index + 1,
          wiki: false,
          embedded: Boolean(bang),
        });
        return " ".repeat(match.length);
      },
    );
    rest = rest.replace(
      /(!?)\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g,
      (match, bang: string, label: string, id: string | undefined) => {
        const target = definitions.get((id || label).trim().toLowerCase());
        if (target)
          references.push({
            target,
            line: index + 1,
            wiki: false,
            embedded: Boolean(bang),
          });
        else if (id !== undefined) unsupported++;
        return target ? " ".repeat(match.length) : match;
      },
    );
    if (/\]\(|\[\[|<\s*(?:a|img)\b/i.test(rest)) unsupported++;
  });
  return { references, anchors, unsupported };
}

/** 保留换行和列位置，屏蔽注释、围栏与缩进代码；行内代码在提取标题后再屏蔽。 */
function maskNonProse(text: string) {
  const blank = (value: string) => value.replace(/[^\n]/g, " ");
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, blank)
    .split("\n");
  let fence: { marker: string; length: number } | null = null;
  return lines
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        if (
          marker &&
          marker[1][0] === fence.marker &&
          marker[1].length >= fence.length &&
          !marker[2].trim()
        )
          fence = null;
        return blank(line);
      }
      if (marker) {
        fence = { marker: marker[1][0], length: marker[1].length };
        return blank(line);
      }
      if (/^(?: {4}|\t)/.test(line)) return blank(line);
      return line;
    })
    .join("\n");
}
