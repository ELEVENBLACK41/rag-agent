/**
 * 修改时间：2026-09-14
 * 文件说明：VaultAgent 来源抽屉的格式级原文件 Viewer 分派。
 *
 * 本组件只根据服务端已声明的 MIME 类型选择 Viewer；各 Viewer 自己维护文件读取、
 * 渲染与定位状态，抽屉外壳不承担格式实现细节。
 *
 * edit by：Sliye
 */

"use client";

import { MarkdownSourceViewer } from "@/components/sources/markdown-source-viewer";
import { DocxSourceViewer } from "@/components/sources/docx-source-viewer";
import { TextSourceViewer } from "@/components/sources/text-source-viewer";
import type { SourcePreview } from "@/lib/sources/types";

type SourceDocumentViewerProps = {
  preview: SourcePreview;
  runId: string;
};

/** 为当前已支持格式分派完整原文件 Viewer，其他格式仍由抽屉的既有降级界面展示。 */
export function SourceDocumentViewer({ preview, runId }: SourceDocumentViewerProps) {
  if (preview.mediaType === "text/plain")
    return <TextSourceViewer fileUrl={preview.fileUrl} highlight={preview.sourceHighlight} />;
  if (preview.mediaType === "text/markdown") {
    const attachmentUrl = `/api/runs/${encodeURIComponent(runId)}/sources/${encodeURIComponent(preview.chunkId)}/attachments`;
    return <MarkdownSourceViewer attachmentUrl={attachmentUrl} fileUrl={preview.fileUrl} highlight={preview.sourceHighlight} />;
  }
  if (preview.mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    return <DocxSourceViewer fileUrl={preview.fileUrl} highlight={preview.sourceHighlight} />;
  return null;
}
