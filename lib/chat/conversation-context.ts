/** 修改时间：2026-09-16 | 文件说明：为 Agent 与最终回答组装有界的最近完整对话 | edit by：Sliye */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { ModelMessage } from "ai";
import { getDatabase } from "@/lib/db/client";
import { messages, runEvents, runs } from "@/lib/db/schema";
import { getAccessibleConversation } from "@/lib/chat/conversations";
import { getVisibleAnswer } from "@/lib/chat/citations";
import type { ChatRun } from "@/lib/chat/types";
import type { SourceCitation } from "@/lib/sources/types";

/** 保留最近完整问答，避免长期对话不断放大模型请求。 */
export const MAX_HISTORY_TURNS = 8;
/** 历史正文的字符预算，不含当前问题；不声称此值等于 token 数。 */
export const MAX_HISTORY_CHARACTERS = 16_000;
export type ConversationContext = {
  messages: ModelMessage[];
  truncated: boolean;
};
export type ConversationTurn = { question: string; answer: string };

/**
 * 整轮裁剪，不能留下没有问题的回答或半截上一轮；当前问题始终完整保留。
 * @param turns 按最近优先排序的完整问答。
 * @param question 当前已校验的问题。
 */
export function buildConversationContext(
  turns: ConversationTurn[],
  question: string,
): ConversationContext {
  const retained: ConversationTurn[] = [];
  let characters = 0;
  for (const turn of turns) {
    const size = turn.question.length + turn.answer.length;
    if (
      retained.length >= MAX_HISTORY_TURNS ||
      characters + size > MAX_HISTORY_CHARACTERS
    )
      break;
    retained.push(turn);
    characters += size;
  }
  return {
    messages: [
      ...retained.reverse().flatMap<ModelMessage>((turn) => [
        { role: "user", content: turn.question },
        { role: "assistant", content: turn.answer },
      ]),
      { role: "user", content: question },
    ],
    truncated: retained.length < turns.length,
  };
}

/** 历史只能解释追问，不能作为本轮证据或覆盖最新用户决定,只给了true和false
 * true 表示历史太长，一部分已经被裁掉，
 * false 表示提供的历史比较完整，能够理解的追问直接承接
 */
export function describeConversationContext(truncated: boolean) {
  return (
    "此前完整问答仅用于理解指代、承接追问和当前明确要求；历史助手回答不是本轮知识库证据，不能继承旧来源编号，需要资料事实时按本轮快照重新获取。以最新用户要求为准。" +
    (truncated
      ? "较早历史已因长度预算省略；仅在现有上下文不足或确有歧义时澄清，不假装记得未提供的内容。"
      : "已有上下文能明确解释的追问直接承接，不要求用户重复说明。")
  );
}

/** 当前轮的用户消息已写库，明确排除本轮及未完成轮次，避免重复提问或引入半截回答。 */
export async function loadConversationContext(
  run: ChatRun,
  question: string,
): Promise<ConversationContext> {
  if (!(await getAccessibleConversation(run.conversationId)))
    throw new Error("目标会话不存在或已经删除。");
  const db = getDatabase();
  const previous = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.conversationId, run.conversationId),
        eq(runs.status, "completed"),
        sql`(${runs.createdAt}, ${runs.id}) < (select created_at, id from runs where id = ${run.runId} and conversation_id = ${run.conversationId})`,
      ),
    )
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(MAX_HISTORY_TURNS + 1);
  if (!previous.length) return buildConversationContext([], question);
  const ids = previous.map((entry) => entry.id);
  const [rows, plainRuns] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, run.conversationId),
          inArray(messages.runId, ids),
          eq(messages.status, "completed"),
        ),
      ),
    db
      .selectDistinct({ runId: runEvents.runId })
      .from(runEvents)
      .where(
        and(
          inArray(runEvents.runId, ids),
          inArray(runEvents.eventType, ["final_delta", "provisional_delta"]),
          sql`${runEvents.payload}->>'format' = 'plain'`,
        ),
      ),
  ]);
  const plain = new Set(plainRuns.map((entry) => entry.runId));
  const turns = previous.flatMap((entry) => {
    const user = rows.find(
      (message) => message.runId === entry.id && message.role === "user",
    );
    const assistant = rows.find(
      (message) => message.runId === entry.id && message.role === "assistant",
    );
    if (!user || !assistant) return [];
    return [
      {
        question: user.content,
        answer: plain.has(entry.id)
          ? assistant.content
          : getVisibleAnswer(
              assistant.content,
              false,
              assistant.citations as SourceCitation[],
            ),
      },
    ];
  });
  return buildConversationContext(turns, question);
}
