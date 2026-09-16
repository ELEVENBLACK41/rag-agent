/** 修改时间：2026-09-16 | 文件说明：Run 的数据库锁、单调事件与不可逆终态边界 | edit by：Sliye */
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { conversations, messages, runEvents, runs } from "@/lib/db/schema";
import { LOCAL_WORKSPACE_ID } from "@/lib/ingestion/imports";
import type { ChatRun } from "@/lib/chat/types";
import type { SourceCitation } from "@/lib/sources/types";
import { RUN_DEADLINE_MS, RUN_EVENT_CHANNEL } from "@/lib/chat/config";

/** 复用 Drizzle 的事务类型，不为持久层引入另一套接口。 */
export type RunTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0];

/** @param runId 目标 Run。所有写入依次锁会话、Run，与删除保持同一锁顺序。 */
export async function withLockedRun<T>(
  runId: string,
  action: (tx: RunTransaction, run: typeof runs.$inferSelect) => Promise<T>,
) {
  return getDatabase().transaction(async (tx) => {
    const [record] = await tx.select().from(runs).where(eq(runs.id, runId));
    if (!record) return null;
    // 官方：https://orm.drizzle.team/docs/select#advanced-select；FOR UPDATE 将序号与终态竞争收敛到数据库。
    // 锁为行级锁,读取这条 Run，并在当前事务结束之前，阻止其他事务修改、删除它，或者取得与之冲突的行锁
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, record.conversationId),
          eq(conversations.workspaceId, LOCAL_WORKSPACE_ID),
          isNull(conversations.deletedAt),
        ),
      )
      .for("update");
    if (!conversation) return null;
    const [run] = await tx
      .select()
      .from(runs)
      .where(eq(runs.id, runId))
      .for("update");//主要是这里 如上锁
    return action(tx, run);
  });
}

/** @param tx 已锁定会话和 Run 的事务。 @param runId Run ID。 @param eventType 事件名。 @param payload 已脱敏载荷。 */
export async function insertRunEvent(
  tx: RunTransaction,
  runId: string,
  eventType: string,
  payload: object,
) {
  const [last] = await tx
    .select({ sequence: runEvents.sequence })
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(desc(runEvents.sequence))
    .limit(1);
  const sequence = (last?.sequence ?? 0) + 1;
  await tx
    .insert(runEvents)
    .values({ id: randomUUID(), runId, sequence, eventType, payload });
  // 官方：https://www.postgresql.org/docs/current/sql-notify.html；事务提交后才通知，回滚不会发布。
  await tx.execute(sql`select pg_notify(${RUN_EVENT_CHANNEL}, ${runId})`);
  return sequence;
}

/** @param runId Run ID。 @param eventType 事件名。 @param payload 已验证数据。终态后禁止迟到事件。 */
export async function appendRunEvent(
  runId: string,
  eventType: string,
  payload: object,
) {
  const sequence = await withLockedRun(runId, async (tx, run) => {
    if (run.status !== "running") return null;
    return insertRunEvent(tx, runId, eventType, payload);
  });
  if (sequence === null) throw new Error("本轮执行已结束或会话已删除。");
  return sequence;
}

/** @param chatRun 固定快照的 Run。 @param answer 完整正文。 @param citations 已重新授权的来源。 */
export async function completeChatRun(
  chatRun: ChatRun,
  answer: string,
  citations: SourceCitation[],
) {
  const completed = await withLockedRun(chatRun.runId, async (tx, run) => {
    if (run.status !== "running") return false;
    if (Date.now() - run.createdAt.getTime() >= RUN_DEADLINE_MS) {
      await finishRun(
        tx,
        run,
        "failed",
        "执行超过时限，已保留部分回答，请主动重试。",
      );
      return false;
    }
    await tx
      .insert(messages)
      .values({
        id: randomUUID(),
        conversationId: run.conversationId,
        runId: run.id,
        role: "assistant",
        content: answer,
        status: "completed",
        citations,
      });
    await tx
      .update(runs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(runs.id, run.id));
    await insertRunEvent(tx, run.id, "run_completed", { citations });
    return true;
  });
  if (!completed) throw new Error("本轮执行已结束或会话已删除。");
}

/** @param runId Run ID。 @param message 用户可见失败原因。已存在终态时保持不变。 */
export async function failChatRun(runId: string, message: string) {
  return withLockedRun(runId, (tx, run) =>
    finishRun(tx, run, "failed", message),
  );
}

/** @param runId 受当前工作区约束的 Run；重复取消返回原终态。 */
export async function cancelChatRun(runId: string) {
  return withLockedRun(runId, (tx, run) =>
    finishRun(tx, run, "cancelled", "已停止生成，当前回答未完成。"),
  );
}

/** @param tx 已持有会话和 Run 锁。 @param run 锁内状态。 @param status 目标终态。 @param message 公开原因。 */
export async function finishRun(
  tx: RunTransaction,
  run: typeof runs.$inferSelect,
  status: "failed" | "cancelled",
  message: string,
) {
  if (run.status !== "running") return run.status;
  await tx
    .update(runs)
    .set({ status, completedAt: new Date() })
    .where(eq(runs.id, run.id));
  await insertRunEvent(
    tx,
    run.id,
    status === "failed" ? "run_failed" : "run_cancelled",
    { message: message.slice(0, 500) },
  );
  return status;
}

/** @param runId Run ID。派发失败、旧执行或服务重启后超过期限时明确失败。 */
export async function reconcileChatRun(runId: string) {
  return withLockedRun(runId, async (tx, run) => {
    if (
      run.status === "running" &&
      Date.now() - run.createdAt.getTime() >= RUN_DEADLINE_MS
    )
      return finishRun(
        tx,
        run,
        "failed",
        "执行中断或超过时限，已保留部分回答，请主动重试。",
      );
    return run.status;
  });
}
