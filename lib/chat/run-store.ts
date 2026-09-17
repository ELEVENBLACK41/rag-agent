/** 修改时间：2026-09-17 | 文件说明：问答 Run 创建、联网选项持久化、重试与受权事件读取 | edit by：Sliye */
import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { conversations, messages, runEvents, runs } from "@/lib/db/schema";
import { ensureLocalPrincipal, LOCAL_WORKSPACE_ID } from "@/lib/ingestion/imports";
import { getLatestPublishedSnapshot } from "@/lib/retrieval/search";
import { getAccessibleConversation } from "@/lib/chat/conversations";
import type { ChatRun } from "@/lib/chat/types";
import { insertRunEvent, reconcileChatRun } from "@/lib/chat/run-lifecycle";

/**
 * 创建单轮问答 Run，开始后始终固定在当前已发布快照上。
 *
 * @param question 已校验的用户问题。
 * @param options 会话、主动重试标识及本轮联网授权；重试必须属于同会话且已经失败或取消。
 */
export async function createChatRun(question: string, options: { conversationId?: string; retryRunId?: string; webSearchEnabled: boolean }): Promise<ChatRun> {
  const { conversationId, retryRunId, webSearchEnabled } = options;
  await ensureLocalPrincipal();
  const snapshot = await getLatestPublishedSnapshot(LOCAL_WORKSPACE_ID);

  const db = getDatabase();
  const runId = randomUUID();
  //如果前端传了 conversationId 就使用前端传的，如果没有就生成一个新的就是新绘画
  const resolvedConversationId = conversationId ?? randomUUID();

  // 验证会话属于当前工作区且未删除，复用历史读取的访问边界。
  if (conversationId && !await getAccessibleConversation(conversationId)) {
    throw new Error("目标会话不存在或已经删除。");
  }

  //使用事务同时写入四类数据
  await db.transaction(async (transaction) => {
    //如果没有传入 conversationId 就创建一个新的会话
    if (!conversationId) {
      await transaction.insert(conversations).values({
        id: resolvedConversationId,
        workspaceId: LOCAL_WORKSPACE_ID,
        title: makeConversationTitle(question),//标题通过问题直接生成 暂时这样 后续可能会接入一个模型生成
      });
    }
    // 会话锁同时约束创建、重试和删除，禁止同会话并行生成不完整上下文。
    const [conversation] = await transaction
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, resolvedConversationId),
          eq(conversations.workspaceId, LOCAL_WORKSPACE_ID),
          isNull(conversations.deletedAt),
        ),
      )
      .for("update");
    if (!conversation) throw new Error("目标会话不存在或已经删除。");
    const [active] = await transaction
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.conversationId, resolvedConversationId),
          eq(runs.status, "running"),
        ),
      )
      .limit(1);
    if (active)
      throw new Error("当前会话仍有执行中的回答，请等待完成或停止后再发送。");
    if (retryRunId) {
      const [previous] = await transaction
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.id, retryRunId),
            eq(runs.conversationId, resolvedConversationId),
          ),
        )
        .for("update");
      const [retried] = await transaction
        .select({ id: runEvents.id })
        .from(runEvents)
        .where(
          and(
            eq(runEvents.runId, retryRunId),
            eq(runEvents.eventType, "run_retried"),
          ),
        )
        .limit(1);
      const [original] = await transaction
        .select({ content: messages.content })
        .from(messages)
        .where(and(eq(messages.runId, retryRunId), eq(messages.role, "user")))
        .limit(1);
      if (
        !previous ||
        !["failed", "cancelled"].includes(previous.status) ||
        retried ||
        original?.content !== question
      )
        throw new Error("只能重试尚未替换的失败或已停止回答。");
      await insertRunEvent(transaction, retryRunId, "run_retried", {
        replacementRunId: runId,
      });
    }
    //创建运行记录
    await transaction.insert(runs).values({
      id: runId,
      conversationId: resolvedConversationId,
      snapshotId: snapshot?.id ?? null,
      status: "running",
    });

    //保存用户消息
    await transaction.insert(messages).values({
      id: randomUUID(),
      conversationId: resolvedConversationId,
      runId,
      role: "user",
      content: question,
      status: "completed",
      citations: [],
    });
    //写入开始事件
    await transaction.insert(runEvents).values({
      id: randomUUID(),
      runId,
      sequence: 1,
      eventType: "run_started",
      payload: { message: "正在处理问题", webSearchEnabled },
    });
  });

  return { conversationId: resolvedConversationId, runId, snapshotId: snapshot?.id ?? null, webSearchEnabled };
}

/**
 * 按序读取已持久化事件，供断线后的 SSE 补齐接口使用。
 *
 * @param runId Run 标识。
 * @param afterSequence 已在浏览器确认的最后事件序号。
 */
export async function getRunEvents(runId: string, afterSequence: number) {
  const [accessible] = await getDatabase().select({ id: runs.id }).from(runs)
    .innerJoin(conversations, eq(runs.conversationId, conversations.id))
    .where(and(eq(runs.id, runId), eq(conversations.workspaceId, LOCAL_WORKSPACE_ID), isNull(conversations.deletedAt))).limit(1);
  if (!accessible) return null;
  if (await reconcileChatRun(runId) === null) return null;
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

/** 以首条问题生成会话标题，避免额外模型调用。 */
function makeConversationTitle(question: string) {
  return question.replace(/\s+/g, " ").trim().slice(0, 60);
}
