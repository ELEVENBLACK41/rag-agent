/**
 * 修改时间：2026-09-07 | 文件说明：VaultAgent D3 单轮检索问答 Run 与事件持久化
 * 此文件为一次问答的执行核心编排文件，结合 lib/retrieval/search.ts 进行检索，并结合 ai-sdk-core 进行模型生成回答
 * 主要负责：
 * 创建单轮问答 Run
 * 固定本次问答使用的知识库快照
 * 调用向量检索
 * 将回答锃亮推送给浏览器
 * 持久化消息，引用，和执行事件
 * 处理失败，短线，会话删除
 *  | edit by：Sliye
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { gateway, streamText } from "ai";
import { getDatabase } from "@/lib/db/client";
import { conversations, messages, runEvents, runs } from "@/lib/db/schema";
import { LOCAL_WORKSPACE_ID } from "@/lib/ingestion/imports";
import {
  getLatestPublishedSnapshot,
  retrievePublishedChunks,
  type RetrievedChunk,
} from "@/lib/retrieval/search";

/** DAY1 已验证的 D3 问答模型。 */
const CHAT_MODEL = "alibaba/qwen3.7-flash";
/** 单次 D3 问答最多生成的 token 数，避免本阶段无界费用。 */
const MAX_OUTPUT_TOKENS = 1_200;
/** 文本增量写入事件库的最短时间窗口，避免逐 token 写库。 */
const EVENT_FLUSH_INTERVAL_MS = 300;

// 给前端展示的引用信息
export type ChatCitation = {
  id: number;
  chunkId: string;
  displayName: string;
  startLine: number;
  endLine: number;
};

// 一次问答执行的身份信息
export type ChatRun = {
  conversationId: string;
  runId: string;
  snapshotId: string; //本次问答使用哪个知识库快照
};
// 推送给浏览器的事件类型
export type ChatStreamEvent =
  | { type: "stage"; data: { message: string } } //阶段消息 例如 ：正在检索已发布的知识库快照
  | { type: "delta"; data: { text: string } } //文本增量
  | { type: "complete"; data: { citations: ChatCitation[] } }; //完成事件，包含引用信息

/**
 * 创建单轮问答 Run，开始后始终固定在当前已发布快照上。
 *
 * @param question 已校验的用户问题。
 * @param conversationId 可选的既有会话标识；未提供时创建新会话。
 */
export async function createChatRun(question: string, conversationId?: string): Promise<ChatRun> {
  const snapshot = await getLatestPublishedSnapshot(LOCAL_WORKSPACE_ID);
  if (!snapshot) throw new Error("请先完成一个 Markdown 文件的导入，再开始提问。");

  const db = getDatabase();
  const runId = randomUUID();
  //如果前端传了 conversationId 就使用前端传的，如果没有就生成一个新的就是新绘画
  const resolvedConversationId = conversationId ?? randomUUID();

  //验证会话是否有效，验证会话ID是否存在，是否属于当前工作区，是否未被删除
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
      snapshotId: snapshot.id,
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
      payload: { message: "正在检索当前知识库" },
    });
  });

  return { conversationId: resolvedConversationId, runId, snapshotId: snapshot.id };
}

/**
 * 执行一次固定检索与一次模型生成，并持续产出可发布给浏览器的事件。
 *
 * @param chatRun 已持久化的单轮问答 Run。
 * @param question 已保存的用户问题。
 * 
 * async function* 很关键，它是一个异步生成器，可以不断的产生事件返回给前端
 * yield 阶段消息
 * yield 文本片段增量
 * yield 完成事件
 * APi层通过这个循环可以把事件发送给浏览器消费，详情可以看 api/chat/route.ts
 */
export async function* executeChatRun(
  chatRun: ChatRun,
  question: string,
): AsyncGenerator<ChatStreamEvent> {
  try {
    yield await createStageEvent(chatRun.runId, "正在检索已发布的知识库快照。");
    //开始调用search了，给快照id和用户的prompt 去搜索
    const sources = await retrievePublishedChunks(chatRun.snapshotId, question);
    
    if (!sources.length) throw new Error("当前资料中没有可用于回答的已索引文本块。");
    //整理一下返回得字段，把相似的啥的先剔除
    const citations = toCitations(sources);
    //再通知浏览器，已经找到多少个候选片段，即将生成回答
    yield await createStageEvent(chatRun.runId, `已找到 ${sources.length} 个候选片段，正在生成回答。`);
    //ai sdk得api 调用模型去流式生成
    const result = streamText({
      model: gateway(CHAT_MODEL),
      system: buildSystemInstruction(sources), //构造模型得上下文
      prompt: question,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      reasoning: "none", // 这里是推理输出 先暂时关闭
    });

    let answer = "";
    let pendingEventText = "";
    let lastEventFlushAt = Date.now();
    //循环读取模型生成得文本
    for await (const textDelta of result.textStream) {
      answer += textDelta;
      //累计写入库得文本
      pendingEventText += textDelta;
      yield { type: "delta", data: { text: textDelta } };
      //每隔300ms就把增量写入数据库，避免每个token都写入数据库
      if (Date.now() - lastEventFlushAt >= EVENT_FLUSH_INTERVAL_MS) {
        await appendRunEvent(chatRun.runId, "final_delta", { text: pendingEventText });
        pendingEventText = "";
        lastEventFlushAt = Date.now();
      }
    }
    //模型结束后补齐文本
    if (pendingEventText) {
      await appendRunEvent(chatRun.runId, "final_delta", { text: pendingEventText });
    }
    if (!answer.trim()) throw new Error("模型没有返回可保存的回答。");
    //完成一次run
    await completeChatRun(chatRun, answer, citations);
    yield { type: "complete", data: { citations } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "知识问答执行失败。";
    await failChatRun(chatRun.runId, message);
    throw error;
  }
}

/**
 * 按序读取已持久化事件，供断线后的 SSE 补齐接口使用。
 *
 * @param runId Run 标识。
 * @param afterSequence 已在浏览器确认的最后事件序号。
 */
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

/**
 * 软删除会话，不会删除其对应的知识库文件。
 *
 * @param conversationId 会话标识。
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

/** 以首条问题生成 D3 会话标题，避免额外模型调用。 */
function makeConversationTitle(question: string) {
  return question.replace(/\s+/g, " ").trim().slice(0, 60);
}

/** 创建并持久化公开可见的阶段说明，不记录模型私密推理。 */
async function createStageEvent(runId: string, message: string): Promise<ChatStreamEvent> {
  await appendRunEvent(runId, "stage_message", { message });
  return { type: "stage", data: { message } };
}

/** 将检索片段转换为稳定的、可呈现的引用信息。 */
function toCitations(sources: RetrievedChunk[]): ChatCitation[] {
  return sources.map((source, index) => ({
    id: index + 1,
    chunkId: source.chunkId,
    displayName: source.displayName,
    startLine: source.startLine,
    endLine: source.endLine,
  }));
}

/** 构造只允许引用提供资料的模型说明与文本上下文。 */
function buildSystemInstruction(sources: RetrievedChunk[]) {
  const sourceText = sources
    .map(
      (source, index) =>
        `【${index + 1}】${source.displayName}（第 ${source.startLine}-${source.endLine} 行）\n${source.content}`,
    )
    .join("\n\n");

  return [
    "你是 VaultAgent。只根据以下知识库片段回答，资料不足时明确说明。",
    "不要编造资料中不存在的内容，也不要输出私密思维过程。",
    "引用关键结论时使用【编号】；编号必须来自提供的资料片段。",
    "资料片段：",
    sourceText,
  ].join("\n\n");
}

/** 按单 Run 的单调序号写入事件。D3 每个 Run 只有一个执行器，不产生并发写入 未来会扩展 */
async function appendRunEvent(runId: string, eventType: string, payload: Record<string, unknown>) {
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
async function completeChatRun(chatRun: ChatRun, answer: string, citations: ChatCitation[]) {
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
async function failChatRun(runId: string, message: string) {
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
