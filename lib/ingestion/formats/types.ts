/**
 * 修改时间：2026-09-12
 * 文件说明：VaultAgent 各格式解析器共享输出与定位类型。
 *
 * 这里是解析层与索引、检索、引用展示之间的稳定契约。每种格式只声明能够
 * 由不可变文件版本复现的位置，不用不可靠的“通用行号”伪造 Office/PDF 定位。
 *
 * edit by：Sliye
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

/** DOCX 正文块按文档内顺序、段落或基础表格定位。 */
export type DocxSourceLocator = {
  format: "docx";
  headingPath: string[];
  blockType: "paragraph" | "table";
  blockIndex: number;
  tableIndex?: number;
};

/** DOCX 内嵌图片的模型描述，仍通过图片序号回溯到同一文件版本。 */
export type DocxVisualSourceLocator = {
  format: "docx-visual";
  imageIndex: number;
  visualAssetId: string;
};

/** XLSX 文本块以工作表名称和 Excel 区域定位，避免伪造行号。 */
export type XlsxSourceLocator = {
  format: "xlsx";
  sheetName: string;
  range: string;
};

/** XLSX 内嵌图片的模型描述，以工作表、锚点单元格和图片顺序回溯。 */
export type XlsxVisualSourceLocator = {
  format: "xlsx-visual";
  sheetName: string;
  anchor: string;
  imageIndex: number;
  visualAssetId: string;
};

/** 统一的原文定位结构；不同格式通过 format 和专属字段表达位置。 */
export type SourceLocator =
  | TextSourceLocator
  | PdfSourceLocator
  | PdfVisualSourceLocator
  | DocxSourceLocator
  | DocxVisualSourceLocator
  | XlsxSourceLocator
  | XlsxVisualSourceLocator;

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
  code:
    | "no-text-layer"
    | "text-extraction-failed"
    | "document-conversion-warning";
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
    locator.format === "docx" &&
    Array.isArray(locator.headingPath) &&
    (locator.blockType === "paragraph" || locator.blockType === "table") &&
    typeof locator.blockIndex === "number" &&
    (locator.tableIndex === undefined || typeof locator.tableIndex === "number")
  ) {
    return locator as DocxSourceLocator;
  }
  if (
    locator.format === "docx-visual" &&
    typeof locator.imageIndex === "number" &&
    typeof locator.visualAssetId === "string"
  ) {
    return {
      format: "docx-visual",
      imageIndex: locator.imageIndex,
      visualAssetId: locator.visualAssetId,
    };
  }
  if (
    locator.format === "xlsx" &&
    typeof locator.sheetName === "string" &&
    typeof locator.range === "string"
  ) {
    return { format: "xlsx", sheetName: locator.sheetName, range: locator.range };
  }
  if (
    locator.format === "xlsx-visual" &&
    typeof locator.sheetName === "string" &&
    typeof locator.anchor === "string" &&
    typeof locator.imageIndex === "number" &&
    typeof locator.visualAssetId === "string"
  ) {
    return {
      format: "xlsx-visual",
      sheetName: locator.sheetName,
      anchor: locator.anchor,
      imageIndex: locator.imageIndex,
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
