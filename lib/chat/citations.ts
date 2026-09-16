/**
 * 修改时间：2026-09-16 | 文件说明：独立来源列表校验与旧版正文引用兼容展示 | edit by：Sliye
 */

import type { SourceCitation } from "@/lib/sources/types";

/**
 * 校验独立来源字段，只发布模型声明使用且属于本轮已读取证据的来源。
 * @param citationIds 已通过输出 Schema 校验的来源编号列表，不从正文提取。
 * @param sources 本轮固定快照内重新校验过的已读取来源。
 */
export function selectAnswerCitations(citationIds: number[], sources: SourceCitation[]) {
  /** 去重后保留模型在独立字段中提供的顺序。 */
  const ids = new Set(citationIds);
  /** 来源编号只能由本轮读取过程分配。 */
  const byId = new Map(sources.map((source) => [source.id, source]));
  return [...ids].map((id) => {
    const source = byId.get(id);
    if (!source) throw new Error("回答包含无效来源编号，请重新提问。");
    return source;
  });
}

/**
 * 仅供旧事件回放：隐藏历史正文中的引用标记，新版正文不经过此函数。
 * @param content 旧版累积的原始回答，可能保留内部编号。
 * @param streaming 是否仍可能接收后续字符。
 * @param citations 历史回答的已发布引用，用于兼容旧的纯数字编号。
 */
export function getVisibleAnswer(content: string, streaming = false, citations: SourceCitation[] = []) {
  const legacyIds = new Set(content.includes("【来源:") ? [] : citations.map((citation) => citation.id));
  const visible = content.replace(/【来源:[^】]*】/g, "").replace(/【来源:[^】]*$/, "").replace(/【(\d+)】/g,
    (marker, id: string) => legacyIds.has(Number(id)) ? "" : marker);
  if (!streaming) return visible;
  const start = visible.lastIndexOf("【");
  if (start < 0) return visible;
  const tail = visible.slice(start);
  return "【来源:".startsWith(tail) || /^【来源:\d*$/.test(tail)
    ? visible.slice(0, start)
    : visible;
}
