/**
 * 修改时间：2026-09-16
 * 文件说明：VaultAgent 跨格式视觉资产来源与分析结果类型。
 *
 * 来源键与来源定位属于原始文件版本，模型结果只是其派生数据。新的格式只需
 * 声明自己的来源定位，即可复用同一套存储、限额与视觉模型调用。
 *
 * edit by：Sliye
 */

/** 派生视觉资产在父文件中的可复现位置。 */
export type VisualSourceLocator =
  | { kind: "pdf-page"; pageNumber: number }
  | {
      kind: "markdown-image";
      attachmentFileVersionId: string;
      sourcePath: string;
      lineNumber?: number;
    }
  | { kind: "document-image"; imageIndex: number }
  | {
      kind: "worksheet-image";
      sheetName: string;
      anchor: string;
      imageIndex: number;
    };

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
      return `markdown-image:${locator.attachmentFileVersionId}:${locator.sourcePath}:${locator.lineNumber ?? 0}`;
    case "document-image":
      return `document-image:${locator.imageIndex}`;
    case "worksheet-image":
      return `worksheet-image:${encodeURIComponent(locator.sheetName)}:${locator.anchor}:${locator.imageIndex}`;
  }
}
