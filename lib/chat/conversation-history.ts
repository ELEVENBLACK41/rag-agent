/** 修改时间：2026-09-16 | 文件说明：按完整问答分页恢复历史消息、来源与公开执行过程 | edit by：Sliye */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { messages, runEvents, runs } from "@/lib/db/schema";
import { reconcileChatRun } from "@/lib/chat/run-lifecycle";
import { getAccessibleConversation } from "@/lib/chat/conversations";
import {
  createAssistantMessage,
  replayMessageEvent,
} from "@/lib/chat/message-state";
import type {
  AnswerCitation,
  ChatMessage,
  ConversationHistory,
  StoredRunEvent,
} from "@/lib/chat/types";

/** 每页最多 20 轮，用户可以继续加载更早的完整问答。 */
const HISTORY_PAGE_SIZE = 20;

/**
 * @param conversationId 当前工作区未删除的会话。
 * @param before 最早一轮 Run ID；数据库内比较时间和 ID，避免 JS 日期丢失微秒精度。
 */
export async function getConversationHistory(
  conversationId: string,
  before?: string,
): Promise<ConversationHistory | null> {
  const conversation = await getAccessibleConversation(conversationId);
  if (!conversation) return null;
  const db = getDatabase();
  const active = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(eq(runs.conversationId, conversationId), eq(runs.status, "running")),
    );
  for (const run of active) await reconcileChatRun(run.id);
  const page = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.conversationId, conversationId),
        sql`not exists (select 1 from run_events where run_id = ${runs.id} and event_type = 'run_retried')`,
        before
          ? sql`(${runs.createdAt}, ${runs.id}) < (select created_at, id from runs where id = ${before} and conversation_id = ${conversationId})`
          : undefined,
      ),
    )
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(HISTORY_PAGE_SIZE + 1);
  const selected = page.slice(0, HISTORY_PAGE_SIZE).reverse();
  if (!selected.length) return { conversation, messages: [], nextBefore: null };
  const ids = selected.map((run) => run.id);
  const [saved, events] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          inArray(messages.runId, ids),
        ),
      )
      .orderBy(messages.createdAt, messages.id),
    db
      .select()
      .from(runEvents)
      .where(
        and(
          inArray(runEvents.runId, ids),
          inArray(runEvents.eventType, [
            "stream_event",
            "run_cancelled",
            "provisional_delta",
            "final_delta",
            "answer_to_stage",
            "stage_message",
            "tool_started",
            "tool_finished",
            "run_completed",
            "run_failed",
          ]),
        ),
      )
      .orderBy(runEvents.sequence),
  ]);
  const result: ChatMessage[] = [];
  for (const run of selected) {
    const runMessages = saved.filter((message) => message.runId === run.id);
    const user = runMessages.find((message) => message.role === "user");
    if (user)
      result.push({
        id: user.id,
        role: "user",
        content: user.content,
        runId: run.id,
      });
    const final = runMessages.find(
      (message) =>
        message.role === "assistant" && message.status === "completed",
    );
    let assistant = {
      ...createAssistantMessage(
        final?.id ?? `assistant:${run.id}`,
        run.createdAt.getTime(),
      ),
      runId: run.id,
    };
    const runRecords = events.filter((event) => event.runId === run.id);
    for (const event of runRecords)
      assistant = {
        ...replayMessageEvent(assistant, event as StoredRunEvent),
        runId: run.id,
      };
    if (final) {
      assistant = {
        ...assistant,
        content: final.content,
        citations: final.citations as AnswerCitation[],
        process: {
          ...assistant.process!,
          status: "completed",
          completedAt: (run.completedAt ?? final.createdAt).getTime(),
          open: false,
        },
      };
    } else if (assistant.process?.status === "running") {
      const failed = run.status === "failed";
      assistant.process = {
        ...assistant.process,
        status:
          run.status === "running"
            ? "running"
            : failed
              ? "failed"
              : "cancelled",
        open: true,
        completedAt:
          run.status === "running"
            ? undefined
            : (run.completedAt ?? run.createdAt).getTime(),
      };
      if (run.status !== "running")
        assistant.error ??= failed
          ? "这轮回答未成功完成。"
          : "已停止生成，当前回答未完成。";
    }
    result.push(assistant);
  }
  return {
    conversation,
    messages: result,
    nextBefore: page.length > HISTORY_PAGE_SIZE ? selected[0].id : null,
  };
}
