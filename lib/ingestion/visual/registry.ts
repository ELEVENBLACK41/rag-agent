/**
 * 修改时间：2026-09-16
 * 文件说明：VaultAgent 可索引文档的受限视觉分析器注册表。
 *
 * Workflow 只传入已经校验的 MIME 类型和导入标识；每种格式自行负责选择视觉
 * 候选，注册表负责分派，避免 Workflow 随格式数量增长为条件分支中心。
 *
 * edit by：Sliye
 */

import { analyzeDocxVisualImages } from "@/lib/ingestion/visual/docx-image-analysis";
import { analyzeMarkdownVisualImages } from "@/lib/ingestion/visual/markdown-image-analysis";
import { analyzePdfVisualPages } from "@/lib/ingestion/visual/pdf-page-analysis";
import { analyzeXlsxVisualImages } from "@/lib/ingestion/visual/xlsx-image-analysis";

type VisualAssetAnalyzer = (importId: string) => Promise<number>;

/** 已实现受限视觉候选处理的可索引文件类型。 */
const VISUAL_ASSET_ANALYZERS: Record<string, VisualAssetAnalyzer> = {
  "text/markdown": analyzeMarkdownVisualImages,
  "application/pdf": analyzePdfVisualPages,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": analyzeDocxVisualImages,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": analyzeXlsxVisualImages,
};

/**
 * 为当前格式执行受限视觉资产分析；没有视觉候选能力的文本格式直接跳过。
 *
 * @param importId 已持久化的导入记录标识。
 * @param mediaType 文件版本的已校验 MIME 类型。
 */
export async function analyzeImportVisualAssets(
  importId: string,
  mediaType: string,
) {
  return VISUAL_ASSET_ANALYZERS[mediaType]?.(importId) ?? 0;
}
