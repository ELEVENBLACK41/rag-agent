/*
 * @Author: shaoliye shaoliye@fengmap.com
 * @Date: 2026-09-16 11:38:52
 * @LastEditors: shaoliye shaoliye@fengmap.com
 * @LastEditTime: 2026-09-16 12:14:24
 * @FilePath: \rag-agent\lib\chat\conversations.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
/** 修改时间：2026-09-16 | 文件说明：受工作区隔离的会话目录、访问检查与软删除 | edit by：Sliye */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { conversations, runs } from "@/lib/db/schema";
import { LOCAL_WORKSPACE_ID } from "@/lib/ingestion/imports";
import { finishRun } from "@/lib/chat/run-lifecycle";
import type { ConversationList } from "@/lib/chat/types";

/** 每次只读取有限会话，避免目录随历史增长无界返回。 */
const CONVERSATION_PAGE_SIZE = 30;

/** @param conversationId 请求指定的会话；已删除和其他工作区统一视为不可用。 */
export async function getAccessibleConversation(conversationId: string) {
  const [conversation] = await getDatabase()
    .select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.workspaceId, LOCAL_WORKSPACE_ID),
        isNull(conversations.deletedAt),
      ),
    )
    .limit(1);
  return conversation ?? null;
}

/** @param offset API 入口校验过的非负分页起点。 */
export async function listConversations(
  offset: number,
): Promise<ConversationList> {
  /** 按最后提问时间排序，无消息会话使用创建时间；不额外维护冗余更新时间。 */
  const updatedAt = sql<string>`coalesce(max(${runs.createdAt}), ${conversations.createdAt})`;
  // 官方：https://orm.drizzle.team/docs/select；聚合后分页，避免一个会话被多轮 Run 重复列出。
  const rows = await getDatabase()
    .select({ id: conversations.id, title: conversations.title, updatedAt })
    .from(conversations)
    .leftJoin(runs, eq(runs.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.workspaceId, LOCAL_WORKSPACE_ID),
        isNull(conversations.deletedAt),
      ),
    )
    .groupBy(conversations.id)
    .orderBy(desc(updatedAt), desc(conversations.id))
    .limit(CONVERSATION_PAGE_SIZE + 1)
    .offset(offset);
  return {
    conversations: rows
      .slice(0, CONVERSATION_PAGE_SIZE)
      .map((row) => ({
        ...row,
        updatedAt: new Date(row.updatedAt).toISOString(),
      })),
    nextOffset:
      rows.length > CONVERSATION_PAGE_SIZE
        ? offset + CONVERSATION_PAGE_SIZE
        : null,
  };
}

/** 软删除只影响当前工作区的会话，不删除知识库文件。 */
export async function deleteConversation(conversationId: string) {
  return getDatabase().transaction(async (tx) => {
    const [conversation] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.workspaceId, LOCAL_WORKSPACE_ID),
          isNull(conversations.deletedAt),
        ),
      )
      .for("update");
    if (!conversation) return false;
    const active = await tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.conversationId, conversationId),
          eq(runs.status, "running"),
        ),
      )
      .for("update");
    for (const run of active)
      await finishRun(tx, run, "cancelled", "会话已删除，执行已停止。");
    await tx
      .update(conversations)
      .set({ deletedAt: new Date() })
      .where(eq(conversations.id, conversationId));
    return true;
  });
}
