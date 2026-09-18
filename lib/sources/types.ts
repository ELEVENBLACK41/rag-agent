/**
 * 修改时间：2026-09-14
 * 文件说明：VaultAgent 来源抽屉与受限 Agent 共享的来源数据契约。
 *
 * 这里的类型只表达已获授权的 Chunk 及其稳定定位；不包含存储键、工作区标识
 * 或其他可用于绕过服务端授权的内部字段。
 *
 * edit by：Sliye
 */

import type { SourceLocator } from "@/lib/ingestion/formats/types";

/** 用于在渲染后文本中消除重复命中歧义的短文本引用。 */
export type TextQuoteSelector = {
  exact: string;
  prefix?: string;
  suffix?: string;
  occurrence?: number;
};

/** Viewer 所需的最小定位表现契约，不改变原始 SourceLocator 的稳定语义。 */
export type SourceHighlight =
  | { kind: "line-range"; startLine: number; endLine: number; quote?: TextQuoteSelector }
  | { kind: "docx-text"; blockIndex: number; quote: TextQuoteSelector }
  | { kind: "docx-image"; imageIndex?: number; relationshipId?: string; contentHash?: string }
  | { kind: "xlsx-range"; sheetName: string; range: string }
  | { kind: "pdf-page"; pageNumber: number };

/** 一条可在回答中引用、也可由来源抽屉打开的证据。 */
export type SourceCitation = {
  id: number;
  chunkId: string;
  displayName: string;
  startLine: number | null;
  endLine: number | null;
  sourceLocator: SourceLocator | null;
};

/** 来源抽屉的文本预览，不把 Office/PDF 的解析文本伪装成完整原文件。 */
export type SourcePreview = {
  chunkId: string;
  displayName: string;
  mediaType: string;
  content: string;
  startLine: number | null;
  endLine: number | null;
  sourceLocator: SourceLocator | null;
  /** 当前引用在 Viewer 中使用的展示定位信息。 */
  sourceHighlight: SourceHighlight | null;
  /** 所有格式共用的受鉴权原文件地址；客户端不得推导存储键。 */
  fileUrl: string;
  /** PDF 可通过此受鉴权地址打开原文件并跳转到对应页。 */
  documentUrl: string | null;
  /** 视觉 Chunk 的派生图片通过受鉴权地址读取。 */
  visualAssetUrl: string | null;
};

/** Agent 读取后的有限证据正文，长度由 Agent State 的预算控制。 */
export type ReadableSource = SourceCitation & {
  content: string;
};
