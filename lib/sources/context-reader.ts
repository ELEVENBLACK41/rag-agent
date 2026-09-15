/**
 * 修改时间：2026-09-15
 * 文件说明：固定知识库快照内的同文相邻内容读取。
 *
 * 该能力按文件版本和 Chunk 顺序扩展上下文，不重新生成查询向量，也不会跨越当前
 * Run 固定的快照边界。
 *
 * edit by：Sliye
 */

import { and, asc, desc, eq, gt, isNull, lt, ne } from "drizzle-orm";
import { chunks, fileVersions, indexSnapshotFiles, logicalFiles } from "@/lib/db/schema";
import { getDatabase } from "@/lib/db/client";
import { readSnapshotSources } from "@/lib/sources/reader";

export type ContextDirection = "before" | "after" | "both";

/**
 * 读取锚点前后最多各一个相邻 Chunk。
 *
 * @param snapshotId 当前 Run 固定的索引快照。
 * @param chunkId 已经读入证据集合的锚点 Chunk。
 * @param direction 需要扩展的相对方向。
 */
export async function readAdjacentSnapshotSources(
  snapshotId: string,
  chunkId: string,
  direction: ContextDirection,
) {
  const db = getDatabase();
  const [anchor] = await db
    .select({ fileVersionId: chunks.fileVersionId, ordinal: chunks.ordinal })
    .from(chunks)
    .innerJoin(
      indexSnapshotFiles,
      and(
        eq(indexSnapshotFiles.snapshotId, snapshotId),
        eq(indexSnapshotFiles.fileVersionId, chunks.fileVersionId),
      ),
    )
    .innerJoin(fileVersions, eq(chunks.fileVersionId, fileVersions.id))
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .where(
      and(
        eq(chunks.id, chunkId),
        eq(fileVersions.status, "indexed"),
        isNull(logicalFiles.deletedAt),
      ),
    )
    .limit(1);

  if (!anchor) return [];

  const beforeIds = direction === "after"
    ? []
    : await readNeighborIds(anchor.fileVersionId, anchor.ordinal, "before");
  const afterIds = direction === "before"
    ? []
    : await readNeighborIds(anchor.fileVersionId, anchor.ordinal, "after");

  return readSnapshotSources(snapshotId, [...beforeIds, ...afterIds]);
}

/** 按确定顺序取得一个相邻 Chunk ID，正文仍由统一来源读取边界返回。 */
async function readNeighborIds(
  fileVersionId: string,
  ordinal: number,
  direction: Exclude<ContextDirection, "both">,
) {
  const ordinalCondition = direction === "before"
    ? lt(chunks.ordinal, ordinal)
    : gt(chunks.ordinal, ordinal);
  const order = direction === "before" ? desc(chunks.ordinal) : asc(chunks.ordinal);
  const records = await getDatabase()
    .select({ chunkId: chunks.id })
    .from(chunks)
    .where(
      and(
        eq(chunks.fileVersionId, fileVersionId),
        ne(chunks.ordinal, ordinal),
        ordinalCondition,
      ),
    )
    .orderBy(order)
    .limit(1);

  return records.map((record) => record.chunkId);
}

