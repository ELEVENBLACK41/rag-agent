/**
 * 修改时间：2026-09-16
 * 文件说明：Markdown 本地附件目标的标准化与 Vault 相对路径解析。
 *
 * 导入期视觉索引和 Run 来源预览共用同一套匹配顺序，避免同一引用在两个阶段
 * 解析到不同文件。这里仅处理纯路径，不读取数据库或文件存储。
 *
 * edit by：Sliye
 */

import path from "node:path";
import { normalizeVaultPath } from "@/lib/ingestion/source-path";

export type MarkdownAttachmentCandidate = {
  sourcePath: string | null;
};

/** 拒绝协议、绝对路径、越界路径和空目标；调用方负责至多解码一次 URL 编码。 */
export function normalizeMarkdownAttachmentTarget(value: string) {
  const target = value
    .trim()
    .replace(/^<|>$/g, "")
    .split("|")[0]
    .split("#")[0]
    .trim();
  if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return null;
  try {
    return normalizeVaultPath(target);
  } catch {
    return null;
  }
}

/** 优先当前笔记目录、再 Vault 根目录，最后只允许全 Vault 唯一的短文件名。 */
export function resolveMarkdownAttachmentPath<T extends MarkdownAttachmentCandidate>(
  sourcePath: string,
  target: string,
  candidates: T[],
): T | "ambiguous" | null {
  const parentDirectory = path.posix.dirname(sourcePath);
  const relativePath = normalizeVaultPath(
    parentDirectory === "." ? target : `${parentDirectory}/${target}`,
  );
  const relativeMatch = candidates.find(
    (candidate) => candidate.sourcePath === relativePath,
  );
  if (relativeMatch) return relativeMatch;

  const rootMatch = candidates.find(
    (candidate) => candidate.sourcePath === target,
  );
  if (rootMatch) return rootMatch;

  if (target.includes("/")) return null;
  const shortNameMatches = candidates.filter(
    (candidate) =>
      candidate.sourcePath && path.posix.basename(candidate.sourcePath) === target,
  );
  if (shortNameMatches.length === 1) return shortNameMatches[0];
  return shortNameMatches.length > 1 ? "ambiguous" : null;
}
