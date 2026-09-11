/**
 * 修改时间：2026-09-11 | 文件说明：VaultAgent 跨格式视觉资产来源与分析结果类型 | edit by：Sliye
 */

/** 派生视觉资产在父文件中的可复现位置。 */
export type VisualSourceLocator =
  | { kind: "pdf-page"; pageNumber: number }
  | { kind: "markdown-image"; sourcePath: string; lineNumber?: number }
  | { kind: "document-image"; imageIndex: number }
  | { kind: "worksheet-image"; sheetName: string; anchor: string };

/** 视觉模型输出的有界描述，不能替代原始文本证据。 */
export type VisualAnalysis = {
  description: string;
  visibleText: string;
  confidence: "high" | "medium" | "low";
};

/** 将来源定位转为同一文件版本内稳定且可建唯一索引的键。 */
export function createVisualSourceKey(locator: VisualSourceLocator) {
  switch (locator.kind) {
    case "pdf-page":
      return `pdf-page:${locator.pageNumber}`;
    case "markdown-image":
      return `markdown-image:${locator.sourcePath}:${locator.lineNumber ?? 0}`;
    case "document-image":
      return `document-image:${locator.imageIndex}`;
    case "worksheet-image":
      return `worksheet-image:${locator.sheetName}:${locator.anchor}`;
  }
}
