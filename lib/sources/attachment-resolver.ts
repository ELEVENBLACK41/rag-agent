/**
 * 修改时间：2026-09-14
 * 文件说明：VaultAgent Markdown 本地图片的快照内路径解析与受权读取。
 *
 * 附件始终从当前 Run 固定快照中匹配，不把本地路径、Blob URL 或跨快照文件暴露给浏览器。
 *
 * edit by：Sliye
 */

import path from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { fileVersions, indexSnapshotFiles, logicalFiles } from "@/lib/db/schema";
import { normalizeVaultPath } from "@/lib/ingestion/source-path";
import { readStoredFile } from "@/lib/storage/files";
import { getRunSourceRecord } from "@/lib/sources/reader";

/** 当前导入入口实际允许作为 Markdown 本地图片返回的 MIME 类型。 */
const MARKDOWN_IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg"];

type AttachmentCandidate = {
  mediaType: string;
  sourcePath: string | null;
  storageKey: string;
};

export type MarkdownAttachmentResult =
  | { kind: "found"; bytes: Uint8Array; mediaType: string }
  | { kind: "ambiguous" }
  | { kind: "invalid" }
  | { kind: "not-found" };

/**
 * 解析并读取一个 Markdown 图片附件。
 *
 * @param runId 当前回答绑定的不可变 Run。
 * @param chunkId 打开 Markdown 原文的已授权来源 Chunk。
 * @param target Markdown 或 Obsidian 语法里记录的原始目标路径。
 */
export async function readRunMarkdownAttachment(
  runId: string,
  chunkId: string,
  target: string,
): Promise<MarkdownAttachmentResult> {
  const source = await getRunSourceRecord(runId, chunkId);
  if (
    !source ||
    source.mediaType !== "text/markdown" ||
    !source.sourcePath ||
    !source.snapshotId
  ) return { kind: "not-found" };

  const normalizedTarget = normalizeAttachmentTarget(target);
  if (!normalizedTarget) return { kind: "invalid" };

  const candidates = await getSnapshotImageCandidates(source.snapshotId);
  const resolved = resolveAttachmentPath(source.sourcePath, normalizedTarget, candidates);
  if (resolved === "ambiguous") return { kind: "ambiguous" };
  if (!resolved) return { kind: "not-found" };

  return { kind: "found", mediaType: resolved.mediaType, bytes: await readStoredFile(resolved.storageKey) };
}

/** 查询同一快照中仍有效的图片附件，不按当前最新 Vault 状态回退。 */
async function getSnapshotImageCandidates(snapshotId: string): Promise<AttachmentCandidate[]> {
  return getDatabase()
    .select({
      mediaType: fileVersions.mediaType,
      sourcePath: logicalFiles.sourcePath,
      storageKey: fileVersions.storageKey,
    })
    .from(indexSnapshotFiles)
    .innerJoin(fileVersions, eq(indexSnapshotFiles.fileVersionId, fileVersions.id))
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .where(
      and(
        eq(indexSnapshotFiles.snapshotId, snapshotId),
        inArray(fileVersions.mediaType, MARKDOWN_IMAGE_MEDIA_TYPES),
        inArray(fileVersions.status, ["stored", "indexed"]),
        isNull(logicalFiles.deletedAt),
      ),
    );
}

/** 拒绝协议、绝对路径、越界和重复解码后的伪路径；调用方不得再次 decode。 */
function normalizeAttachmentTarget(value: string) {
  const target = value.trim().replace(/^<|>$/g, "").split("|")[0].split("#")[0].trim();
  if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return null;
  try {
    return normalizeVaultPath(target);
  } catch {
    return null;
  }
}

/** 优先当前笔记目录、再 Vault 根目录，最后只允许全 Vault 唯一的短文件名。 */
function resolveAttachmentPath(
  sourcePath: string,
  target: string,
  candidates: AttachmentCandidate[],
) {
  const parentDirectory = path.posix.dirname(sourcePath);
  const relativePath = normalizeVaultPath(
    parentDirectory === "." ? target : `${parentDirectory}/${target}`,
  );
  const relativeMatch = candidates.find((candidate) => candidate.sourcePath === relativePath);
  if (relativeMatch) return relativeMatch;

  const rootMatch = candidates.find((candidate) => candidate.sourcePath === target);
  if (rootMatch) return rootMatch;

  if (target.includes("/")) return null;
  const shortNameMatches = candidates.filter(
    (candidate) => candidate.sourcePath && path.posix.basename(candidate.sourcePath) === target,
  );
  if (shortNameMatches.length === 1) return shortNameMatches[0];
  return shortNameMatches.length > 1 ? "ambiguous" : null;
}
