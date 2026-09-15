/**
 * 修改时间：2026-09-15
 * 文件说明：VaultAgent 问题执行模式的结构化路由器。
 *
 * 路由器只读取当前问题，不接收知识库正文，也不直接授予工具权限；服务端根据结果
 * 选择直接回答、单次检索或受限 Agent，避免所有问题都进入完整工具循环。
 *
 * edit by：Sliye
 */

import { gateway, generateText, Output } from "ai";
import { z } from "zod";
import { CHAT_MODEL } from "@/lib/agent/model-config";

/** 当前支持的三种问答执行路径。 */
export const QUERY_MODES = ["direct", "retrieve", "agent"] as const;

/** 模型必须返回的最小路由契约。 */
const queryRouteSchema = z.object({
  mode: z.enum(QUERY_MODES).describe("本次问题应进入的执行路径"),
  query: z.string().trim().min(1).max(600)
    .describe("用于知识库检索的独立、明确查询；direct 模式保留原问题语义"),
});

export type QueryRoute = z.infer<typeof queryRouteSchema>;

/**
 * 使用结构化输出判断问题所需的最小执行路径。
 * AI SDK 文档：https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data
 *
 * @param question API 边界已经校验过的当前用户问题。
 */
export async function routeQuestion(question: string): Promise<QueryRoute> {
  const result = await generateText({
    model: gateway(CHAT_MODEL),
    output: Output.object({ schema: queryRouteSchema }),
    system: [
      "你是 VaultAgent 的查询路由器，只分类执行方式，不回答问题。",
      "direct：寒暄、能力询问、文本改写等完全不依赖私人知识库的请求。",
      "retrieve：需要知识库，但一次混合检索和读取即可回答的单一事实或总结问题。",
      "agent：需要跨来源比较、分步骤核对、补充上下文或可能二次搜索的复杂任务。",
      "问题提到资料、文档、笔记、知识库、前文或来源时，不得选择 direct。",
      "拿不准时选择 retrieve；不要因为问题较长就自动选择 agent。",
      "query 必须保留用户限定条件，不得补造实体、时间或版本。",
    ].join("\n"),
    prompt: question,
    maxOutputTokens: 180,
    reasoning: "none",
  });

  return result.output;
}

