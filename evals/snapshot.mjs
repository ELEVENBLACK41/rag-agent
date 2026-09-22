/** 修改时间：2026-09-22 | 文件说明：固定评测资料哈希校验与稳定证据定位解析 | edit by：Sliye */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { corpusFiles } from "./classic/dataset.mjs";
import { getDatabase } from "../lib/db/client.ts";
import { chunks, fileVersions, indexSnapshotFiles, indexSnapshots, logicalFiles } from "../lib/db/schema.ts";
import { LOCAL_WORKSPACE_ID } from "../lib/ingestion/imports.ts";

/** 以本文件确定仓库根目录，不依赖命令行调用位置。 */
const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** @param {string|Buffer} value 固定资料字节或有序清单。 */
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

/** @param {object} item 固定清单中的一份资料。 */
async function expectedFileHash(item) {
  const pathname = "content" in item ? path.join(projectDirectory, "evals", "classic", "corpus", item.file) : path.join(projectDirectory, item.source);
  const bytes = await readFile(pathname);
  if ("content" in item && !bytes.equals(Buffer.from(item.content, "utf8"))) throw new Error(`测试资料内容与数据集不一致：${item.file}`);
  return sha256(bytes);
}

/** @param {string} snapshotId 运行前固定的已发布快照 UUID。 */
export async function verifySnapshot(snapshotId) {
  const db = getDatabase();
  const [snapshot] = await db.select().from(indexSnapshots).where(and(eq(indexSnapshots.id, snapshotId), eq(indexSnapshots.workspaceId, LOCAL_WORKSPACE_ID))).limit(1);
  if (!snapshot || snapshot.status !== "published") throw new Error("快照不存在或尚未发布。");
  const files = await db.select({ name: logicalFiles.displayName, hash: fileVersions.contentHash })
    .from(indexSnapshotFiles)
    .innerJoin(fileVersions, eq(indexSnapshotFiles.fileVersionId, fileVersions.id))
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .where(eq(indexSnapshotFiles.snapshotId, snapshotId));
  if (files.length !== corpusFiles.length || new Set(files.map((file) => file.name)).size !== corpusFiles.length) throw new Error("评测快照必须恰好包含固定清单中的十个不同文件。");
  const expected = await Promise.all(corpusFiles.map(async (item) => ({ name: item.file, hash: await expectedFileHash(item) })));
  for (const item of expected) if (!files.some((file) => file.name === item.name && file.hash === item.hash)) throw new Error(`评测快照的文件内容不匹配：${item.name}`);
  return sha256(JSON.stringify(expected.sort((left, right) => left.name.localeCompare(right.name))));
}

/** @param {object} locator 数据库中已索引 Chunk 的结构化原文定位。 @param {object} expected 预先标注的稳定证据定位。 */
function matchesEvidence(locator, expected) {
  if (!locator || typeof locator !== "object") return false;
  if (expected.blockId) return Array.isArray(locator.blockIds) && locator.blockIds.includes(expected.blockId);
  if (expected.link) return Array.isArray(locator.links) && locator.links.includes(expected.link);
  return Object.entries(expected).every(([key, value]) => key === "file" || locator[key] === value);
}

/** @param {string} snapshotId 固定快照 UUID。 @param {object[]} selectedCases 本次执行的固定题目。 */
export async function resolveEvidence(snapshotId, selectedCases) {
  const rows = await getDatabase().select({ id: chunks.id, name: logicalFiles.displayName, locator: chunks.sourceLocator })
    .from(chunks)
    .innerJoin(fileVersions, eq(chunks.fileVersionId, fileVersions.id))
    .innerJoin(indexSnapshotFiles, eq(indexSnapshotFiles.fileVersionId, fileVersions.id))
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .where(eq(indexSnapshotFiles.snapshotId, snapshotId));
  return new Map(selectedCases.map((item) => {
    const matched = item.expectedEvidence.flatMap((expected) => {
      const found = rows.filter((row) => row.name === expected.file && matchesEvidence(row.locator, expected)).map((row) => row.id);
      if (!found.length) throw new Error(`找不到标注证据：${item.id} / ${expected.file}`);
      if (found.length !== 1) throw new Error(`证据定位不是唯一 Chunk：${item.id} / ${expected.file}`);
      return found;
    });
    return [item.id, new Set(matched)];
  }));
}
