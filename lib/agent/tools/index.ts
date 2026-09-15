/**
 * 修改时间：2026-09-15
 * 文件说明：VaultAgent 只读工具注册入口。
 *
 * 每个工具在独立文件中实现稳定领域职责；本文件只负责为当前 Run 组装工具集合。
 *
 * edit by：Sliye
 */

import type { VaultRunState } from "@/lib/agent/run-state";
import { createExpandContextTool } from "@/lib/agent/tools/expand-context";
import { createFinishResearchTool } from "@/lib/agent/tools/finish-research";
import { createReadSourcesTool } from "@/lib/agent/tools/read-sources";
import { createSearchNotesTool } from "@/lib/agent/tools/search-notes";

/**
 * 为当前 Run 组装权限和预算均绑定到 state 的四项只读工具。
 * @param state 当前 Run 独占的工具状态。
 */
export function createVaultTools(state: VaultRunState) {
  return {
    read_sources: createReadSourcesTool(state),
    expand_context: createExpandContextTool(state),
    search_notes: createSearchNotesTool(state),
    finish_research: createFinishResearchTool(state),
  };
}
