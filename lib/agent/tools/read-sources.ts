/**
 * 修改时间：2026-09-15
 * 文件说明：Agent 有界读取已获准来源的工具。
 *
 * 工具只允许读取服务器初始检索或一次补搜返回的 Chunk，不接受任意来源标识。
 *
 * edit by：Sliye
 */

import { tool } from "ai";
import { z } from "zod";
import {
  MAX_READ_CHUNKS_PER_CALL,
  type VaultRunState,
} from "@/lib/agent/run-state";
import { readSnapshotSources } from "@/lib/sources/reader";
import { toToolSource } from "@/lib/agent/tools/source-presentation";

/**
 * 创建绑定当前 Run 许可集合的来源读取工具。
 * @param state 当前 Run 的候选许可和引用状态。
 */
export function createReadSourcesTool(state: VaultRunState) {
  return tool({
    description: "读取服务器已许可的少量候选来源，并获得最终回答可用的引用编号。",
    inputSchema: z.object({
      briefing: z.string().trim().min(1).max(200)
        .describe("公开说明准备核对哪些候选证据，1 至 2 句"),
      chunkIds: z.array(z.string().uuid()).min(1).max(MAX_READ_CHUNKS_PER_CALL)
        .describe("必须来自服务器提供的初始候选或补充搜索结果"),
    }),
    strict: true,
    execute: async ({ chunkIds }) => {
      state.beginToolCall();
      state.assertReadable(chunkIds);
      const sources = await readSnapshotSources(state.snapshotId, chunkIds);
      if (sources.length !== chunkIds.length)
        throw new Error("部分来源已不可读取，请重新评估现有证据。");
      return { sources: sources.map((source) => toToolSource(source, state)) };
    },
  });
}
