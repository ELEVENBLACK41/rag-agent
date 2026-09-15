/**
 * 修改时间：2026-09-15
 * 文件说明：Agent 本地证据收集的显式完成工具。
 *
 * 完成状态来自服务器记录的真实引用数量，不接受模型自行填报完成数量。
 *
 * edit by：Sliye
 */

import { tool } from "ai";
import { z } from "zod";
import type { VaultRunState } from "@/lib/agent/run-state";

/**
 * 创建本次 Run 的证据收集完成工具。
 * @param state 当前 Run 的真实引用和调用预算状态。
 */
export function createFinishResearchTool(state: VaultRunState) {
  return tool({
    description: "现有证据足够，或一次补搜后仍不足时，结束本地证据收集。",
    inputSchema: z.object({
      briefing: z.string().trim().min(1).max(200)
        .describe("公开说明已确认内容和仍然缺少的证据，1 至 2 句"),
    }),
    strict: true,
    execute: async () => {
      state.beginToolCall();
      return {
        status: state.getCitationCount()
          ? "evidence-ready"
          : "insufficient-evidence",
        citationCount: state.getCitationCount(),
      };
    },
  });
}
