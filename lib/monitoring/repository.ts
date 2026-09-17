/*
 * @Author: shaoliye shaoliye@fengmap.com
 * @Date: 2026-09-17 15:11:59
 * @LastEditors: shaoliye shaoliye@fengmap.com
 * @LastEditTime: 2026-09-17 15:16:42
 * @FilePath: \rag-agent\lib\monitoring\repository.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
/** 修改时间：2026-09-17 | 文件说明：仅供管理端读取的有界 Run、会话与观测查询 | edit by：Sliye */
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/lib/db/client";
import {
  conversations,
  runs,
  runEvents,
  runObservations,
  importBatches,
  imports,
  fileVersions,
  chunks,
  visualAssets,
} from "@/lib/db/schema";
import { isOwner } from "@/lib/auth/owner";

/** 查询在入口解析一次，避免无限加载历史。 */
export const monitorFilterSchema = z.object({
  hours: z.coerce.number().int().min(1).max(720).default(24),
  status: z
    .enum(["all", "running", "completed", "failed", "cancelled"])
    .default("all"),
  conversationId: z.string().uuid().optional(),
});
export type MonitorFilter = z.infer<typeof monitorFilterSchema>;

/** @param filter 已校验筛选条件。结果最多 100 个 Run，统计明确限定为当前样本。 */
export async function getMonitorRuns(filter: MonitorFilter) {
  if (!(await isOwner())) throw new Error("需要所有者身份。");
  const db = getDatabase();
  const rows = await db
    .select({
      id: runs.id,
      conversationId: runs.conversationId,
      title: conversations.title,
      snapshotId: runs.snapshotId,
      status: runs.status,
      createdAt: runs.createdAt,
      completedAt: runs.completedAt,
    })
    .from(runs)
    .innerJoin(conversations, eq(runs.conversationId, conversations.id))
    .where(
      and(
        isNull(conversations.deletedAt),
        gte(runs.createdAt, new Date(Date.now() - filter.hours * 3_600_000)),
        filter.status === "all" ? undefined : eq(runs.status, filter.status),
        filter.conversationId
          ? eq(runs.conversationId, filter.conversationId)
          : undefined,
      ),
    )
    .orderBy(desc(runs.createdAt))
    .limit(101);
  const selected = rows.slice(0, 100);
  const ids = selected.map((row) => row.id);
  const observations = ids.length
    ? await db
        .select()
        .from(runObservations)
        .where(inArray(runObservations.runId, ids))
    : [];
  return { runs: selected, observations, truncated: rows.length > 100 };
}

/** @param runId 已验证标识；管理读取也排除已删除会话。 */
export async function getMonitorRun(runId: string) {
  if (!(await isOwner())) throw new Error("需要所有者身份。");
  const db = getDatabase();
  const [run] = await db
    .select({ run: runs, title: conversations.title })
    .from(runs)
    .innerJoin(conversations, eq(runs.conversationId, conversations.id))
    .where(and(eq(runs.id, runId), isNull(conversations.deletedAt)))
    .limit(1);
  if (!run) return null;
  const [events, observations] = await Promise.all([
    db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(runEvents.sequence),
    db
      .select()
      .from(runObservations)
      .where(eq(runObservations.runId, runId))
      .orderBy(runObservations.createdAt),
  ]);
  // 只返回结构化过程及来源；正文增量不进入管理记录导出。
  const selectedEvents = events.filter(
    (event) =>
      event.eventType !== "stream_event" ||
      (typeof event.payload === "object" &&
        event.payload !== null &&
        "type" in event.payload &&
        event.payload.type === "tool"),
  );
  const hasTools = events.some(
    (event) =>
      event.eventType === "stream_event" &&
      (event.payload as { type?: string } | null)?.type === "tool",
  );
  return {
    ...run,
    events: selectedEvents,
    observations,
    eventCount: events.length,
    firstProgressAt:
      events.find(
        (event) =>
          event.eventType === "stream_event" &&
          ["stage", "tool"].includes(
            (event.payload as { type?: string } | null)?.type ?? "",
          ),
      )?.createdAt ?? null,
    firstAnswerAt:
      events.find((event) => {
        const payload = event.payload as {
          type?: string;
          data?: { provisional?: boolean };
        } | null;
        return (
          event.eventType === "stream_event" &&
          payload?.type === "delta" &&
          (payload.data?.provisional !== true ||
            (!hasTools && run.run.status === "completed"))
        );
      })?.createdAt ?? null,
  };
}

/** 资源统计独立于问答用量，避免索引费用重复记入每轮。 */
export async function getResourceSummary() {
  if (!(await isOwner())) throw new Error("需要所有者身份。");
  const db = getDatabase();
  const [files, chunkRows, images, batches, pending] = await Promise.all([
    db
      .select({
        count: sql<number>`count(*)::int`,
        bytes: sql<string>`coalesce(sum(${fileVersions.byteSize}), 0)::text`,
      })
      .from(fileVersions),
    db.select({ count: sql<number>`count(*)::int` }).from(chunks),
    db
      .select({
        status: visualAssets.status,
        count: sql<number>`count(*)::int`,
      })
      .from(visualAssets)
      .groupBy(visualAssets.status),
    db
      .select({
        id: importBatches.id,
        status: importBatches.status,
        createdAt: importBatches.createdAt,
        completedAt: importBatches.completedAt,
      })
      .from(importBatches)
      .orderBy(desc(importBatches.createdAt))
      .limit(20),
    db
      .select({ status: imports.status, count: sql<number>`count(*)::int` })
      .from(imports)
      .groupBy(imports.status),
  ]);
  return {
    files: files[0],
    chunks: chunkRows[0].count,
    images,
    latestBatches: batches,
    imports: pending,
    byteScope:
      "数据库中全部文件版本声明的原文件字节，含旧版本；不是磁盘实际占用",
    cleanupBacklog: null,
    workflowStorageBytes: null,
  };
}
