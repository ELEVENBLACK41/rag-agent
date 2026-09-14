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
  /** PDF 可通过此受鉴权地址打开原文件并跳转到对应页。 */
  documentUrl: string | null;
  /** 视觉 Chunk 的派生图片通过受鉴权地址读取。 */
  visualAssetUrl: string | null;
};

/** Agent 读取后的有限证据正文，长度由 Agent State 的预算控制。 */
export type ReadableSource = SourceCitation & {
  content: string;
};
