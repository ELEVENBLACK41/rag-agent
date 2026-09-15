/**
 * 修改时间：2026-09-15
 * 文件说明：Agent 同文相邻 Chunk 上下文扩展工具。
 *
 * 与旧 find_related 不同，本工具不重新向量检索，而是围绕已读取证据确定性读取
 * 同一文件版本的相邻内容。
 *
 * edit by：Sliye
 */

import { tool } from "ai";
import { z } from "zod";
import type { VaultRunState } from "@/lib/agent/run-state";
import { readAdjacentSnapshotSources } from "@/lib/sources/context-reader";
import { toToolSource } from "@/lib/agent/tools/source-presentation";

/**
 * 创建绑定当前已读证据集合的相邻上下文工具。
 * @param state 当前 Run 的已读证据和工具预算状态。
 */
export function createExpandContextTool(state: VaultRunState) {
  return tool({
    description: "围绕一条已读取证据，读取同一文件中紧邻的上文、下文或两侧内容。",
    inputSchema: z.object({
      briefing: z.string().trim().min(1).max(200)
        .describe("公开说明当前证据缺少哪部分上下文，1 至 2 句"),
      chunkId: z.string().uuid().describe("必须是 read_sources 已读取的证据 Chunk ID"),
      direction: z.enum(["before", "after", "both"])
        .describe("需要读取锚点之前、之后或两侧的相邻内容"),
    }),
    strict: true,
    execute: async ({ chunkId, direction }) => {
      state.beginToolCall();
      state.assertCited(chunkId);
      const sources = await readAdjacentSnapshotSources(
        state.snapshotId,
        chunkId,
        direction,
      );
      return { sources: sources.map((source) => toToolSource(source, state)) };
    },
  });
}
