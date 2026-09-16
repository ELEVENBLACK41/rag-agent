/**
 * 修改时间：2026-09-16 | 文件说明：校验回答来源与内联图片选择，不解析正文引用标记 | edit by：Sliye
 */

import type { AnswerCitation } from "@/lib/chat/types";
import type { SourceCitation } from "@/lib/sources/types";

/** 仅允许已有原图读取链路的 Markdown、Word 和 Excel 视觉来源内联展示。 */
export function isDisplayableImageCitation(source: SourceCitation) {
  const format = source.sourceLocator?.format;
  return (
    format === "markdown-visual" ||
    format === "docx-visual" ||
    format === "xlsx-visual"
  );
}

/**
 * 校验独立来源字段，只发布模型声明使用且属于本轮已读取证据的来源；
 * 图片选择自动并入回答来源，避免展示没有来源卡片的孤立图片。
 *
 * @param citationIds 已通过输出 Schema 校验的来源编号列表，不从正文提取。
 * @param imageCitationIds 模型要求内联展示的视觉来源编号。
 * @param sources 本轮固定快照内重新校验过的已读取来源。
 */
export function selectAnswerCitations(
  citationIds: number[],
  imageCitationIds: number[],
  sources: SourceCitation[],
) {
  /** 正文来源优先；只用于展示的图片按模型顺序补在后面。 */
  const ids = new Set([...citationIds, ...imageCitationIds]);
  const imageIds = new Set(imageCitationIds);
  /** 来源编号只能由本轮读取过程分配。 */
  const byId = new Map(sources.map((source) => [source.id, source]));
  return [...ids].map<AnswerCitation>((id) => {
    const source = byId.get(id);
    if (!source) throw new Error("回答包含无效来源编号，请重新提问。");
    if (imageIds.has(id) && !isDisplayableImageCitation(source))
      throw new Error("回答包含不可展示的图片来源，请重新提问。");
    return imageIds.has(id) ? { ...source, displayImage: true } : source;
  });
}
