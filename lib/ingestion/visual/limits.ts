/**
 * 修改时间：2026-09-13
 * 文件说明：VaultAgent 视觉处理的统一资源与渲染限制。
 *
 * 本文件是 visual 领域唯一的限制策略来源。跨格式限制不带格式前缀；暂时只由
 * PDF 使用的渲染参数保留 PDF_ 前缀，避免误导 Office 图片提取逻辑。
 *
 * edit by：Sliye
 */

/** 同一导入批次可创建的视觉资产总数，跨 PDF 页和 Office 内嵌图片累计。 */
export const MAX_VISUAL_ASSETS_PER_IMPORT_BATCH = 5;
/** 单份可索引文件自动送入视觉分析的最大候选数量。 */
export const MAX_VISUAL_CANDIDATES_PER_FILE = 2;
/** 低于该边长的图像不含足够语义，且部分视觉供应商会直接拒绝。 */
export const MIN_VISUAL_IMAGE_EDGE_PIXELS = 16;
/** 单张送入视觉模型的图片允许的最大像素数。 */
export const MAX_VISUAL_IMAGE_PIXELS = 2_000_000;


// PDF 页面渲染策略

/** PDF 页面渲染图的最长边上限，仅由 PDF 渲染器使用。 */
export const PDF_RENDER_MAX_EDGE_PIXELS = 2_048;
/** PDF 页面视觉渲染的默认倍率，仅由 PDF 渲染器使用。 */
export const PDF_RENDER_DEFAULT_SCALE = 1.5;
