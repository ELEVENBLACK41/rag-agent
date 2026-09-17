/** 修改时间：2026-09-17 | 文件说明：管理观测记录的脱敏类型，不保存模型请求与推理正文 | edit by：Sliye */
export type CallUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  reasoningTokens: number | null;
};

export type ModelObservation = {
  kind: "model";
  phase: "research" | "answer";
  callId: string;
  modelId: string;
  provider: string;
  status: "started" | "completed";
  startedAt: string;
  durationMs: number | null;
  usage: CallUsage | null;
  finishReason: string | null;
  /** 不从 token 猜价格；账单数据未接入时为空。 */
  costUsd: number | null;
};
