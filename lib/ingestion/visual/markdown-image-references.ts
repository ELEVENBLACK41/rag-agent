/**
 * 修改时间：2026-09-16
 * 文件说明：从 Markdown Chunk 中解析并匹配图片附件引用。
 *
 * 本模块只处理引用语义和路径匹配，不查询业务状态，也不调用视觉模型。
 *
 * edit by：Sliye
 */

import { toSourceLocator } from "@/lib/ingestion/formats/types";
import {
  normalizeMarkdownAttachmentTarget,
  resolveMarkdownAttachmentPath,
} from "@/lib/ingestion/markdown-attachment-path";
import { MAX_VISUAL_CANDIDATES_PER_FILE } from "@/lib/ingestion/visual/limits";
import {
  getCandidateSnapshotImages,
  getMarkdownChunkReferences,
  type MarkdownImageCandidate,
  type MarkdownImportRecord,
} from "@/lib/ingestion/visual/markdown-image-records";

/** 从 Markdown 附件列表排除 PDF、Office 等非图片目标。 */
const MARKDOWN_IMAGE_EXTENSION = /\.(?:png|jpe?g)$/i;

export type MarkdownImageReference = {
  candidate: MarkdownImageCandidate;
  startLine: number;
  endLine: number;
};

/** 从 Markdown Chunk 的附件定位中解析当前候选快照内的真实图片版本。 */
export async function resolveMarkdownImageReferences(
  importRecord: MarkdownImportRecord,
  targetBatchId: string,
) {
  if (!importRecord.sourcePath) return [];
  const [chunkRecords, candidates] = await Promise.all([
    getMarkdownChunkReferences(importRecord.fileVersionId),
    getCandidateSnapshotImages(importRecord.workspaceId, targetBatchId),
  ]);
  const references = new Map<string, MarkdownImageReference>();
  const sourcePath = importRecord.sourcePath;

  for (const chunk of chunkRecords) {
    const locator = toSourceLocator(chunk.sourceLocator);
    if (
      locator?.format !== "markdown" ||
      locator.contentKind === "code" ||
      chunk.startLine === null ||
      chunk.endLine === null
    ) continue;

    collectChunkReferences({
      candidates,
      importId: importRecord.importId,
      sourcePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      references,
      locatorTargets: locator.attachments,
    });
  }
  return [...references.values()].slice(0, MAX_VISUAL_CANDIDATES_PER_FILE);
}

/** 将一个正文 Chunk 的图片引用加入去重后的候选集合。 */
function collectChunkReferences(input: {
  candidates: MarkdownImageCandidate[];
  importId: string;
  sourcePath: string;
  startLine: number;
  endLine: number;
  references: Map<string, MarkdownImageReference>;
  locatorTargets: string[];
}) {
  for (const rawTarget of input.locatorTargets) {
    const decodedTarget = decodeMarkdownTarget(rawTarget);
    if (!decodedTarget || !MARKDOWN_IMAGE_EXTENSION.test(decodedTarget)) continue;
    const target = normalizeMarkdownAttachmentTarget(decodedTarget);
    if (!target) continue;
    const resolved = resolveMarkdownAttachmentPath(
      input.sourcePath,
      target,
      input.candidates,
    );
    if (!resolved || resolved === "ambiguous") {
      console.warn("[ingestion:visual] Markdown image reference cannot be resolved", {
        importId: input.importId,
        target,
        status: resolved === "ambiguous" ? "ambiguous" : "not-found",
      });
      continue;
    }
    if (!input.references.has(resolved.fileVersionId)) {
      input.references.set(resolved.fileVersionId, {
        candidate: resolved,
        startLine: input.startLine,
        endLine: input.endLine,
      });
    }
  }
}

/** Markdown URL 目标只解码一次；失败时不尝试猜测路径。 */
function decodeMarkdownTarget(target: string) {
  try {
    return decodeURIComponent(target);
  } catch {
    return null;
  }
}
