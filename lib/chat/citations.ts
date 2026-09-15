/**
 * 修改时间：2026-09-16 | 文件说明：回答引用的服务端筛选与流式、历史正文统一展示 | edit by：Sliye
 */

import type { SourceCitation } from "@/lib/sources/types";

/**
 * 只发布正文实际使用且属于本轮已读取证据的编号；无效编号作为生成错误。
 * @param answer 保留内部【来源:编号】的完整回答。
 * @param sources 本轮固定快照内重新校验过的已读取来源。
 */
export function selectAnswerCitations(answer: string, sources: SourceCitation[]) {
  /** 专用引用标记必须闭合且编号为正整数；格式错误不能悄悄降级为无来源。 */
  const markers = [...answer.matchAll(/【来源:([^】]*)】/g)];
  if (/【来源:[^】]*$/.test(answer) || markers.some((match) => !/^[1-9]\d*$/.test(match[1]))) {
    throw new Error("回答的来源标记格式无效，请重新提问。");
  }
  /** 去重后保留正文首次引用顺序。 */
  const ids = new Set(markers.map((match) => Number(match[1])));
  /** 来源编号只能由本轮读取过程分配。 */
  const byId = new Map(sources.map((source) => [source.id, source]));
  return [...ids].map((id) => {
    const source = byId.get(id);
    if (!source) throw new Error("回答包含无效来源编号，请重新提问。");
    return source;
  });
}

/**
 * 隐藏内部引用标记；流式尾部暂缓显示未闭合编号，避免逐 token 泄露。
 * @param content 累积的原始回答，持久化时仍保留内部编号。
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
