/**
 * 修改时间：2026-09-15
 * 文件说明：VaultAgent 聊天 Run 的服务端事件与身份契约。
 * edit by：Sliye
 */

import type { SourceCitation } from "@/lib/sources/types";

/** 给前端展示的引用信息，必须来自服务端实际读取的证据。 */
export type ChatCitation = SourceCitation;

/** 公开工具活动摘要，不包含模型参数、来源正文或私密思维。 */
export type ChatToolActivity = {
  toolCallId: string;
  toolName: string;
  status: "started" | "completed" | "failed";
  message: string;
};

/** 公开阶段文本增量；stageId 用于前端合并同一段内容。 */
export type ChatStageUpdate = {
  stageId: string;
  delta: string;
  status: "active" | "complete";
};

/** 一次问答执行固定的会话、Run 与知识库快照。 */
export type ChatRun = {
  conversationId: string;
  runId: string;
  snapshotId: string;
};

/** API 逐帧推送给浏览器的公开事件。 */
export type ChatStreamEvent =
  | { type: "stage"; data: ChatStageUpdate }
  | { type: "tool"; data: ChatToolActivity }
  | { type: "delta"; data: { text: string } }
  | { type: "complete"; data: { citations: ChatCitation[] } };

