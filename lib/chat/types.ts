/*
 * @Author: shaoliye shaoliye@fengmap.com
 * @Date: 2026-09-16 11:36:49
 * @LastEditors: shaoliye shaoliye@fengmap.com
 * @LastEditTime: 2026-09-16 14:00:06
 * @FilePath: \rag-agent\lib\chat\types.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
/** 修改时间：2026-09-16 | 文件说明：聊天事件、历史消息与会话列表的共享契约 | edit by：Sliye */
import type { SourceCitation } from "@/lib/sources/types";

export type ChatRun = {
  conversationId: string;
  runId: string;
  snapshotId: string | null;
};
export type ChatToolActivity = {
  toolCallId: string;
  toolName: string;
  status: "started" | "completed" | "failed";
  message: string;
};
export type ChatStageUpdate = {
  stageId: string;
  delta: string;
  status: "active" | "complete";
  replace?: boolean;
};
export type ChatStreamEvent =
  | { type: "run"; data: ChatRun }
  | { type: "stage"; data: ChatStageUpdate }
  | { type: "tool"; data: ChatToolActivity }
  | { type: "delta"; data: { text: string; provisional?: boolean } }
  | { type: "answer-stage"; data: { stages: ChatStageUpdate[] } }
  | { type: "complete"; data: { citations: SourceCitation[] } }
  | { type: "cancelled"; data: { message: string } }
  | { type: "error"; data: { message: string } };
export type RunProcessEvent =
  | {
      id: string;
      kind: "stage";
      message: string;
      status: "active" | "complete";
    }
  | {
      id: string;
      kind: "tool";
      message: string;
      status: "started" | "completed" | "failed";
    };
export type RunProcessState = {
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  startedAt: number;
  completedAt?: number;
  open: boolean;
  events: RunProcessEvent[];
};
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  runId?: string;
  citations?: SourceCitation[];
  /** 已应用的持久事件游标，用于历史恢复后的精确补齐。 */
  lastSequence?: number;
  process?: RunProcessState;
  error?: string;
};
export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
};
export type ConversationList = {
  conversations: ConversationSummary[];
  nextOffset: number | null;
};
export type ConversationHistory = {
  conversation: { id: string; title: string };
  messages: ChatMessage[];
  /** 最早一轮的 ID；继续向前分页不受新消息插入影响。 */
  nextBefore: string | null;
};
export type StoredRunEvent = {
  sequence: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};
