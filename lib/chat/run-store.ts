/** 修改时间：2026-09-16 | 文件说明：问答 Run、事件和最终消息的数据库写入边界 | edit by：Sliye */
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { conversations, messages, runEvents, runs } from "@/lib/db/schema";
import { ensureLocalPrincipal, LOCAL_WORKSPACE_ID } from "@/lib/ingestion/imports";
import { getLatestPublishedSnapshot } from "@/lib/retrieval/search";
import { getAccessibleConversation } from "@/lib/chat/conversations";
import type { ChatRun } from "@/lib/chat/types";
import type { SourceCitation as ChatCitation } from "@/lib/sources/types";
/** 同一进程内串行化单个 Run 的事件序号；跨进程恢复留到持久执行阶段。 */
const pendingEventWrites = new Map<string, Promise<void>>();

/**
 * 创建单轮问答 Run，开始后始终固定在当前已发布快照上。
 *
 * @param question 已校验的用户问题。
 * @param conversationId 可选的既有会话标识；未提供时创建新会话。
 */
export async function createChatRun(question: string, conversationId?: string): Promise<ChatRun> {
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
      payload: { message: "正在处理问题" },
    });
  });

  return { conversationId: resolvedConversationId, runId, snapshotId: snapshot?.id ?? null };
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

/** 以首条问题生成 D3 会话标题，避免额外模型调用。 */
function makeConversationTitle(question: string) {
  return question.replace(/\s+/g, " ").trim().slice(0, 60);
}

/**
 * 按单 Run 的单调序号写入事件。
 *
 * 单轮流式生成与检索 Trace 都会写入事件，因此在当前执行器中串行化 sequence 分配。
 * D10 的跨进程恢复会补充持久执行租约和数据库级并发处理。
 */
export async function appendRunEvent(runId: string, eventType: string, payload: object) {
  const previousWrite = pendingEventWrites.get(runId) ?? Promise.resolve();
  const write = previousWrite
    .catch(() => undefined)
    .then(() => writeRunEvent(runId, eventType, payload));
  pendingEventWrites.set(runId, write);
  try {
    await write;
  } finally {
    if (pendingEventWrites.get(runId) === write) pendingEventWrites.delete(runId);
  }
}

/** 在已串行化的上下文中查询并分配下一个事件序号。 */
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

/** 同一事务提交最终回答、Run 终态与完成事件，避免刷新后出现双重完成。 */
export async function completeChatRun(chatRun: ChatRun, answer: string, citations: ChatCitation[]) {
  const db = getDatabase();
  await db.transaction(async (transaction) => {
    const [lastEvent] = await transaction
      .select({ sequence: runEvents.sequence })
      .from(runEvents)
      .where(eq(runEvents.runId, chatRun.runId))
      .orderBy(desc(runEvents.sequence))
      .limit(1);
  //保存助手消息
    await transaction.insert(messages).values({
      id: randomUUID(),
      conversationId: chatRun.conversationId,
      runId: chatRun.runId,
      role: "assistant",
      content: answer,
      status: "completed",
      citations,
    });
  //更新run得状态
    await transaction
      .update(runs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(runs.id, chatRun.runId));
  //写入完成事件
    await transaction.insert(runEvents).values({
      id: randomUUID(),
      runId: chatRun.runId,
      sequence: (lastEvent?.sequence ?? 0) + 1,
      eventType: "run_completed",
      payload: { citations },
    });
  });
}

/** 保存失败终态与安全错误消息，保留此前已验证的事件。 */
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
