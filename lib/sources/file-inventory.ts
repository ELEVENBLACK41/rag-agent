/**
 * 修改时间：2026-09-16 | 文件说明：固定快照内的文件元数据清单与分页证据读取 | edit by：Sliye
 */

import { and, count, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import {
  fileVersions,
  indexSnapshotFiles,
  indexSnapshots,
  logicalFiles,
} from "@/lib/db/schema";
import { LOCAL_WORKSPACE_ID } from "@/lib/ingestion/imports";

/** 每次工具调用最多返回的文件数，限制模型上下文；总数不受此限制。 */
export const FILE_LIST_PAGE_SIZE = 30;

/** 文件清单只证明文件存在与格式，不作为文件正文的证据。 */
export type FileInventory = {
  totalCount: number;
  files: { name: string; path: string | null; mediaType: string }[];
  complete: boolean;
};

/**
 * 读取已成功请求的分页范围；最终生成前重查，防止已删除文件继续作为清单证据。
 * @param snapshotId 服务端为本轮固定的快照，不接受模型自行指定。
 * @param offsets 入口已校验的非负分页偏移；合并范围可去除重复页和重叠页。
 */
export async function readFileInventory(
  snapshotId: string,
  offsets: number[],
): Promise<FileInventory> {
  // 官方：https://orm.drizzle.team/docs/transactions；同一只读事务保证计数和分页视图一致。
  return getDatabase().transaction(
    async (transaction) => {
      const [snapshot] = await transaction
        .select({ id: indexSnapshots.id })
        .from(indexSnapshots)
        .where(
          and(
            eq(indexSnapshots.id, snapshotId),
            eq(indexSnapshots.workspaceId, LOCAL_WORKSPACE_ID),
            eq(indexSnapshots.status, "published"),
          ),
        )
        .limit(1);
      if (!snapshot) throw new Error("文件清单所属快照不存在或不可访问。");

      /** 与检索相同：旧数据没有路径时按文件名识别，同路径只保留最新写入版本。 */
      const identity = sql<string>`coalesce(${logicalFiles.sourcePath}, ${logicalFiles.displayName})`;
      // 官方：https://orm.drizzle.team/docs/select#distinct-select；先选最新版本，再过滤其索引状态。
      const latest = transaction
        .selectDistinctOn([identity], {
          name: logicalFiles.displayName,
          path: logicalFiles.sourcePath,
          mediaType: fileVersions.mediaType,
          status: fileVersions.status,
        })
        .from(indexSnapshotFiles)
        .innerJoin(
          fileVersions,
          eq(indexSnapshotFiles.fileVersionId, fileVersions.id),
        )
        .innerJoin(
          logicalFiles,
          eq(fileVersions.logicalFileId, logicalFiles.id),
        )
        .where(
          and(
            eq(indexSnapshotFiles.snapshotId, snapshotId),
            eq(logicalFiles.workspaceId, LOCAL_WORKSPACE_ID),
            isNull(logicalFiles.deletedAt),
          ),
        )
        .orderBy(identity, desc(fileVersions.createdAt), desc(fileVersions.id))
        .as("latest_files");

      const [total] = await transaction
        .select({ count: count() })
        .from(latest)
        .where(eq(latest.status, "indexed"));
      /** 路径身份唯一，按同一身份排序保证分页稳定，同名不同目录不会合并。 */
      const ranked = transaction
        .select({
          name: latest.name,
          path: latest.path,
          mediaType: latest.mediaType,
          position:
            sql<number>`row_number() over (order by coalesce(${latest.path}, ${latest.name})) - 1`.as(
              "position",
            ),
        })
        .from(latest)
        .where(eq(latest.status, "indexed"))
        .as("ranked_files");
      const files = offsets.length
        ? await transaction
            .select({
              name: ranked.name,
              path: ranked.path,
              mediaType: ranked.mediaType,
            })
            .from(ranked)
            .where(
              or(
                ...offsets.map((offset) =>
                  and(
                    gte(ranked.position, offset),
                    lt(ranked.position, offset + FILE_LIST_PAGE_SIZE),
                  ),
                ),
              ),
            )
            .orderBy(ranked.position)
        : [];

      return {
        totalCount: total.count,
        files,
        complete: files.length === total.count,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
