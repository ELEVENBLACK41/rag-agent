/**
 * 修改时间：2026-09-15
 * 文件说明：VaultAgent D10 受限多步问答 Agent 装配。
 *
 * 每个 Run 临时创建一个 Agent，避免把快照、候选来源或引用状态放在模块级单例。
 * 模型只能调用本地只读工具，最终结论必须基于读取或相邻扩展返回的证据。
 *
 * AI SDK Agent 文档：https://ai-sdk.dev/docs/ai-sdk-core/agents
 *
 * edit by：Sliye
 */

import { gateway, hasToolCall, stepCountIs, ToolLoopAgent } from "ai";
import { createVaultTools } from "@/lib/agent/tools";
import { CHAT_MODEL } from "@/lib/agent/model-config";
import type { VaultRunState } from "@/lib/agent/run-state";

/** 单次问答最多执行六个模型步骤，避免工具循环无限延长。 */
export const MAX_AGENT_STEPS = 6;
/** Agent 公开阶段和工具决策的累计输出上限。 */
export const MAX_AGENT_OUTPUT_TOKENS = 1_200;
/**
 * 为当前 Run 组装工具和说明，不将任何私有正文直接放入系统提示。
 * @param state 当前 Run 独占的权限、证据和工具预算状态。
 */
export function createVaultRunAgent(state: VaultRunState) {
  return new ToolLoopAgent({
    model: gateway(CHAT_MODEL),
    instructions: [
      "你是 VaultAgent，负责根据用户当前知识库回答问题。",
      "服务器会提供一次初始检索候选；优先使用 read_sources 阅读候选，不要重复搜索。",
      "只能根据 read_sources 或 expand_context 返回的内容作答；资料不足时明确说明。",
      "工具返回的 citationId 只供服务器记录来源，公开阶段说明和最终正文不要输出引用编号。",
      "只有初始候选不足时才能调用一次 search_notes；query 必须针对明确的证据缺口。",
      "需要同一文件的上下文时使用 expand_context，不要为相邻内容重新向量检索。",
      "每次调用工具都要填写 briefing；它是展示给用户的公开阶段说明，不是私密思维。",
      "读取足够证据后调用 finish_research，不在工具循环里输出完整最终答案。",
      "如果不再调用工具，只输出不超过两句的公开证据小结：说明已确认内容和仍缺证据，不展开正式答案。",
      "不输出私密思维过程、工具内部参数、Chunk ID 或存储信息。",
      "工具只能读取资料，绝不能修改资料或调用网络。",
    ].join("\n"),
    tools: createVaultTools(state),
    stopWhen: [hasToolCall("finish_research"), stepCountIs(MAX_AGENT_STEPS)],
    maxOutputTokens: MAX_AGENT_OUTPUT_TOKENS,
    reasoning: "none",
    prepareStep: () => {
      if (state.needsSourceRead()) {
        return {
          activeTools: ["read_sources"],
          toolChoice: { type: "tool", toolName: "read_sources" },
        };
      }

      if (!state.getCitationCount() && state.canSupplementalSearch()) {
        return {
          activeTools: ["search_notes"],
          toolChoice: { type: "tool", toolName: "search_notes" },
        };
      }

      return {
        activeTools: state.canSupplementalSearch()
          ? ["read_sources", "expand_context", "search_notes", "finish_research"]
          : ["read_sources", "expand_context", "finish_research"],
        toolChoice: "auto",
      };
    },
  });
}
