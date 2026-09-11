/**
 * 修改时间：2026-09-11 | 文件说明：VaultAgent 各格式解析器共享输出与定位类型 | edit by：Sliye
 */

/** Markdown 与 TXT 的原文定位信息。 */
export type TextSourceLocator = {
  format: "markdown" | "plain-text";
  headingPath: string[];
  blockIds: string[];
  links: string[];
  attachments: string[];
};

/** PDF 文本块固定绑定到原始 PDF 的物理页码。 */
export type PdfSourceLocator = {
  format: "pdf";
  pageNumber: number;
};

/** 视觉模型对 PDF 页面生成的派生描述，仍回溯到同一物理页。 */
export type PdfVisualSourceLocator = {
  format: "pdf-visual";
  pageNumber: number;
  visualAssetId: string;
};

/** 统一的原文定位结构；不同格式通过 format 和专属字段表达位置。 */
export type SourceLocator =
  | TextSourceLocator
  | PdfSourceLocator
  | PdfVisualSourceLocator;

/** 任一可索引格式产生的文本块；PDF 没有可复现的行号。 */
export type ParsedTextChunk = {
  content: string;
  startLine: number | null;
  endLine: number | null;
  sourceLocator: SourceLocator;
};

/** 解析成功但需要向用户说明范围或可靠性的诊断信息。 */
export type ImportDiagnostic = {
  severity: "warning";
  stage: "parse";
  code: "no-text-layer" | "text-extraction-failed";
  message: string;
  pageNumber?: number;
};

/** 一个格式解析器完成后交给索引工作流的统一结果。 */
export type ParsedDocument = {
  chunks: ParsedTextChunk[];
  diagnostics: ImportDiagnostic[];
};

/** 将数据库 JSON 定位字段收窄为已知格式，兼容 D3 的历史空对象。 */
export function toSourceLocator(value: unknown): SourceLocator | null {
  if (!value || typeof value !== "object") return null;
  const locator = value as Record<string, unknown>;
  if (locator.format === "pdf" && typeof locator.pageNumber === "number") {
    return { format: "pdf", pageNumber: locator.pageNumber };
  }
  if (
    locator.format === "pdf-visual" &&
    typeof locator.pageNumber === "number" &&
    typeof locator.visualAssetId === "string"
  ) {
    return {
      format: "pdf-visual",
      pageNumber: locator.pageNumber,
      visualAssetId: locator.visualAssetId,
    };
  }
  if (
    (locator.format === "markdown" || locator.format === "plain-text") &&
    Array.isArray(locator.headingPath) &&
    Array.isArray(locator.blockIds) &&
    Array.isArray(locator.links) &&
    Array.isArray(locator.attachments)
  ) {
    return locator as SourceLocator;
  }
  return null;
}
