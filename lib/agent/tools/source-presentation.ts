/**
 * 修改时间：2026-09-15
 * 文件说明：Agent 工具共享的来源输出转换。
 *
 * 这里只处理展示定位、引用编号与正文限长，不访问数据库或执行检索。
 *
 * edit by：Sliye
 */

import {
  MAX_SOURCE_CHARACTERS,
  type VaultRunState,
} from "@/lib/agent/run-state";
import type { ReadableSource, SourceCitation } from "@/lib/sources/types";

/**
 * 把读取结果转换成模型可使用、长度受限且带稳定引用编号的工具输出。
 * @param source 已通过快照边界读取的来源。
 * @param state 当前 Run 的引用状态。
 */
export function toToolSource(source: ReadableSource, state: VaultRunState) {
  const citation = state.addCitation(toCitation(source));
  return {
    citationId: citation.id,
    title: citation.displayName,
    location: describeSourceLocation(citation),
    content: source.content.slice(0, MAX_SOURCE_CHARACTERS),
  };
}

/**
 * 为确定性单次检索路径生成稳定、连续的引用编号。
 * @param sources 按最终排序读取的有限来源。
 */
export function createSourceCitations(
  sources: ReadableSource[],
): SourceCitation[] {
  return sources.map((source, index) => ({
    ...toCitation(source),
    id: index + 1,
  }));
}

/**
 * 将跨格式来源定位压缩成模型可理解的短说明。
 * @param source 带跨格式定位信息的来源或候选。
 */
export function describeSourceLocation(source: {
  startLine: number | null;
  endLine: number | null;
  sourceLocator: SourceCitation["sourceLocator"];
}) {
  if (source.sourceLocator?.format === "pdf")
    return `第 ${source.sourceLocator.pageNumber} 页`;
  if (source.sourceLocator?.format === "pdf-visual")
    return `第 ${source.sourceLocator.pageNumber} 页 · 视觉分析`;
  if (source.sourceLocator?.format === "docx")
    return source.sourceLocator.blockType === "table"
      ? `表格 ${source.sourceLocator.tableIndex ?? source.sourceLocator.blockIndex}`
      : `段落 ${source.sourceLocator.blockIndex}`;
  if (source.sourceLocator?.format === "docx-visual")
    return `内嵌图片 ${source.sourceLocator.imageIndex}`;
  if (source.sourceLocator?.format === "xlsx")
    return `${source.sourceLocator.sheetName} · ${source.sourceLocator.range}`;
  if (source.sourceLocator?.format === "xlsx-visual")
    return `${source.sourceLocator.sheetName} · ${source.sourceLocator.anchor} · 图片 ${source.sourceLocator.imageIndex}`;
  if (source.startLine !== null && source.endLine !== null)
    return `第 ${source.startLine}-${source.endLine} 行`;
  return "位置不可用";
}

/** 去除读取结果中的正文和临时引用编号，生成可持久化引用。 */
function toCitation(source: ReadableSource): Omit<SourceCitation, "id"> {
  return {
    chunkId: source.chunkId,
    displayName: source.displayName,
    startLine: source.startLine,
    endLine: source.endLine,
    sourceLocator: source.sourceLocator,
  };
}
