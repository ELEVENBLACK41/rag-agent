/**
 * 修改时间：2026-09-15
 * 文件说明：VaultAgent Run 事件的顺序持久化与断线读取。
 *
 * 同一 Node 执行内按 Run 串行分配 sequence；跨进程租约和数据库锁仍属于后续恢复范围。
 *
 * edit by：Sliye
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { runEvents } from "@/lib/db/schema";

/** 同一 Run 尚未完成的事件写入链。 */
const pendingEventWrites = new Map<string, Promise<void>>();

/**
 * 按单 Run 的单调序号持久化一条事件。
 *
 * @param runId 当前问答 Run 标识。
 * @param eventType 稳定事件类型。
 * @param payload 已脱敏且大小受控的事件数据。
 */
export async function appendRunEvent(
  runId: string,
  eventType: string,
  payload: object,
) {
  const previousWrite = pendingEventWrites.get(runId) ?? Promise.resolve();
  const write = previousWrite
    .catch(() => undefined)
    .then(() => writeRunEvent(runId, eventType, payload));
  pendingEventWrites.set(runId, write);
  try {
    await write;
  } finally {
    if (pendingEventWrites.get(runId) === write)
      pendingEventWrites.delete(runId);
  }
}

/** 读取指定序号之后的事件，供 SSE 断线补齐。 */
export async function getRunEvents(runId: string, afterSequence: number) {
  return getDatabase()
    .select({
      sequence: runEvents.sequence,
      eventType: runEvents.eventType,
      payload: runEvents.payload,
      createdAt: runEvents.createdAt,
    })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.sequence, afterSequence)))
    .orderBy(runEvents.sequence);
}

/** 在已经串行化的上下文中分配下一个事件序号。 */
async function writeRunEvent(runId: string, eventType: string, payload: object) {
  const db = getDatabase();
  const [lastEvent] = await db
    .select({ sequence: runEvents.sequence })
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(desc(runEvents.sequence))
    .limit(1);

  await db.insert(runEvents).values({
    id: randomUUID(),
    runId,
    sequence: (lastEvent?.sequence ?? 0) + 1,
    eventType,
    payload,
  });
}

