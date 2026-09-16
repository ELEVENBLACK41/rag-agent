/**
 * 修改时间：2026-09-16 | 文件说明：校验独立来源列表，不解析正文引用标记 | edit by：Sliye
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
