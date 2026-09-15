/**
 * 修改时间：2026-09-15
 * 文件说明：Agent 证据不足时使用的补充知识库搜索工具。
 *
 * 初始混合检索由服务器直接执行。本工具最多补搜一次，且有初始候选时必须先读取
 * 证据，避免 Agent 重复支付 Embedding 与 rerank 成本。
 *
 * edit by：Sliye
 */

import { tool } from "ai";
import { z } from "zod";
import type { VaultRunState } from "@/lib/agent/run-state";
import { retrievePublishedChunksWithTrace } from "@/lib/retrieval/search";
import { describeSourceLocation } from "@/lib/agent/tools/source-presentation";

/**
 * 创建绑定当前 Run 状态的补充搜索工具。
 * @param state 当前 Run 的检索许可、证据和调用预算。
 */
export function createSearchNotesTool(state: VaultRunState) {
  return tool({
    description: "仅在初始候选不足时补充搜索当前知识库，最多调用一次。",
    inputSchema: z.object({
      briefing: z.string().trim().min(1).max(200)
        .describe("公开说明现有证据缺少什么以及准备补搜什么，1 至 2 句"),
      query: z.string().trim().min(1).max(600)
        .describe("不同于初始查询、用于弥补明确证据缺口的查询"),
    }),
    strict: true,
    execute: async ({ query }) => {
      state.beginSupplementalSearch();
      const result = await retrievePublishedChunksWithTrace(
        state.snapshotId,
        query,
      );
      await state.recordRetrievalTrace(result.trace);
      state.permitChunks(
        result.chunks.map((chunk) => chunk.chunkId),
        true,
      );
      return {
        matches: result.chunks.map((chunk) => ({
          chunkId: chunk.chunkId,
          title: chunk.displayName,
          location: describeSourceLocation(chunk),
        })),
      };
    },
  });
}
