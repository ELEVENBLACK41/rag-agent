/**
 * 修改时间：2026-09-14
 * 文件说明：VaultAgent D9 受限多步问答 Agent 装配。
 *
 * 每个 Run 临时创建一个 Agent，避免把快照、候选来源或引用状态放在模块级单例。
 * 模型只能调用本地只读工具，最终结论必须基于 read_sources 已返回的证据。
 *
 * AI SDK Agent 文档：https://ai-sdk.dev/docs/ai-sdk-core/agents
 *
 * edit by：Sliye
 */

import { gateway, stepCountIs, ToolLoopAgent } from "ai";
import { createVaultTools } from "@/lib/agent/tools";
import type { VaultRunState } from "@/lib/agent/run-state";

/** D9 最多执行六个模型步骤，避免工具循环无限延长。 */
export const MAX_AGENT_STEPS = 6;
/** D9 保持既有单轮输出上限，预算细化由 D10 继续实现。 */
export const MAX_AGENT_OUTPUT_TOKENS = 1_200;
/** D1 已真实验证的主问答模型。 */
const CHAT_MODEL = "alibaba/qwen3.7-flash";

/** 为当前 Run 组装工具和说明，不将任何私有正文直接放入系统提示。 */
export function createVaultRunAgent(state: VaultRunState) {
  return new ToolLoopAgent({
    model: gateway(CHAT_MODEL),
    instructions: [
      "你是 VaultAgent，负责根据用户当前知识库回答问题。",
      "先使用 search_notes 搜索，再使用 read_sources 阅读支持结论的来源。",
      "只能根据 read_sources 返回的内容作答；资料不足时明确说明，不要猜测。",
      "关键结论必须使用 read_sources 返回的【citationId】形式引用。",
      "不输出私密思维过程、工具内部参数、Chunk ID 或存储信息。",
      "工具只能读取资料，绝不能修改资料或调用网络。",
    ].join("\n"),
    tools: createVaultTools(state),
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    maxOutputTokens: MAX_AGENT_OUTPUT_TOKENS,
    reasoning: "none",
    prepareStep: ({ steps }) => {
      if (!steps.length) return { toolChoice: { type: "tool", toolName: "search_notes" } };
      return {};
    },
  });
}
