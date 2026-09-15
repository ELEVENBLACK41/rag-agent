/**
 * 修改时间：2026-09-15
 * 文件说明：VaultAgent 会话与聊天 Run 的持久化生命周期。
 *
 * 本模块创建固定快照 Run，并以事务保存最终消息、引用和成功或失败终态。
 *
 * edit by：Sliye
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { conversations, messages, runEvents, runs } from "@/lib/db/schema";
import { LOCAL_WORKSPACE_ID } from "@/lib/ingestion/imports";
import { getLatestPublishedSnapshot } from "@/lib/retrieval/search";
import type { ChatCitation, ChatRun } from "@/lib/chat/run-types";

/**
 * 创建单轮问答 Run，开始后始终固定在当前已发布快照上。
 *
 * @param question 已校验的用户问题。
 * @param conversationId 可选既有会话标识；未提供时创建新会话。
 */
export async function createChatRun(
  question: string,
  conversationId?: string,
): Promise<ChatRun> {
  const snapshot = await getLatestPublishedSnapshot(LOCAL_WORKSPACE_ID);
  if (!snapshot)
    throw new Error("请先完成一个知识库文件的导入，再开始提问。");

  const db = getDatabase();
  const runId = randomUUID();
  const resolvedConversationId = conversationId ?? randomUUID();

  if (conversationId) {
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.workspaceId, LOCAL_WORKSPACE_ID),
          isNull(conversations.deletedAt),
        ),
      )
      .limit(1);
    if (!conversation) throw new Error("目标会话不存在或已经删除。");
  }

  await db.transaction(async (transaction) => {
    if (!conversationId) {
      await transaction.insert(conversations).values({
        id: resolvedConversationId,
        workspaceId: LOCAL_WORKSPACE_ID,
        title: makeConversationTitle(question),
      });
    }
    await transaction.insert(runs).values({
      id: runId,
      conversationId: resolvedConversationId,
      snapshotId: snapshot.id,
      status: "running",
    });
    await transaction.insert(messages).values({
      id: randomUUID(),
      conversationId: resolvedConversationId,
      runId,
      role: "user",
      content: question,
      status: "completed",
      citations: [],
    });
    await transaction.insert(runEvents).values({
      id: randomUUID(),
      runId,
      sequence: 1,
      eventType: "run_started",
      payload: { message: "正在处理问题" },
    });
  });

  return {
    conversationId: resolvedConversationId,
    runId,
    snapshotId: snapshot.id,
  };
}

/**
 * 软删除会话，不会删除其对应的知识库文件。
 * @param conversationId 当前工作区内的会话标识。
 */
export async function deleteConversation(conversationId: string) {
  const result = await getDatabase()
    .update(conversations)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.workspaceId, LOCAL_WORKSPACE_ID),
        isNull(conversations.deletedAt),
      ),
    )
    .returning({ id: conversations.id });

  return result.length > 0;
}

/**
 * 同一事务提交最终回答、Run 终态与完成事件。
 * @param chatRun 当前成功完成的 Run。
 * @param answer 已完整生成的最终回答。
 * @param citations 最终回答实际发布的引用。
 */
export async function completeChatRun(
  chatRun: ChatRun,
  answer: string,
  citations: ChatCitation[],
) {
  const db = getDatabase();
  await db.transaction(async (transaction) => {
    const [lastEvent] = await transaction
      .select({ sequence: runEvents.sequence })
      .from(runEvents)
      .where(eq(runEvents.runId, chatRun.runId))
      .orderBy(desc(runEvents.sequence))
      .limit(1);

    await transaction.insert(messages).values({
      id: randomUUID(),
      conversationId: chatRun.conversationId,
      runId: chatRun.runId,
      role: "assistant",
      content: answer,
      status: "completed",
      citations,
    });
    await transaction
      .update(runs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(runs.id, chatRun.runId));
    await transaction.insert(runEvents).values({
      id: randomUUID(),
      runId: chatRun.runId,
      sequence: (lastEvent?.sequence ?? 0) + 1,
      eventType: "run_completed",
      payload: { citations },
    });
  });
}

/**
 * 保存失败终态与安全错误消息，保留此前已经验证的事件。
 * @param runId 需要结束为失败的 Run。
 * @param message 已过滤到可持久化边界的错误消息。
 */
export async function failChatRun(runId: string, message: string) {
  const db = getDatabase();
  await db.transaction(async (transaction) => {
    const [lastEvent] = await transaction
      .select({ sequence: runEvents.sequence })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(desc(runEvents.sequence))
      .limit(1);

    await transaction
      .update(runs)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(runs.id, runId));
    await transaction.insert(runEvents).values({
      id: randomUUID(),
      runId,
      sequence: (lastEvent?.sequence ?? 0) + 1,
      eventType: "run_failed",
      payload: { message: message.slice(0, 500) },
    });
  });
}

/** 以首条问题生成会话标题，避免额外模型调用。 */
function makeConversationTitle(question: string) {
  return question.replace(/\s+/g, " ").trim().slice(0, 60);
}
