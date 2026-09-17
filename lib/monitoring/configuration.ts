/** 修改时间：2026-09-17 | 文件说明：从实际执行常量读取配置并生成不可变观测快照 | edit by：Sliye */
import { createHash } from "node:crypto";
import * as retrieval from "@/lib/retrieval/config";
import {
  CHAT_MODEL,
  MAX_AGENT_STEPS,
  MAX_AGENT_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  RUN_DEADLINE_MS,
} from "@/lib/chat/config";
import {
  MAX_AGENT_TOOL_CALLS,
  MAX_AGENT_SEARCH_CALLS,
  MAX_READ_CHUNKS_PER_CALL,
  MAX_SOURCE_CHARACTERS,
} from "@/lib/agent/run-state";
import {
  MAX_HISTORY_TURNS,
  MAX_HISTORY_CHARACTERS,
} from "@/lib/chat/conversation-context";
import { MAX_WEB_SEARCH_CALLS, MAX_WEB_SOURCES, WEB_SEARCH_TOKEN_BUDGET, WEB_SEARCH_PAGE_TOKEN_BUDGET } from "@/lib/agent/web-search";
import { MAX_CHUNK_CHARACTERS, CHUNKING_VERSION } from "@/lib/ingestion/formats/chunking-config";
import * as visualLimits from "@/lib/ingestion/visual/limits";

/** 配置快照只包含白名单常量和版本；密钥只报告是否存在。 */
export function getEffectiveConfiguration() {
  const configuration = {
    version: "runtime-configuration-v1",
    chat: {
      model: CHAT_MODEL,
      maxSteps: MAX_AGENT_STEPS,
      stepOutputTokens: MAX_AGENT_OUTPUT_TOKENS,
      answerOutputTokens: MAX_OUTPUT_TOKENS,
      deadlineMs: RUN_DEADLINE_MS,
      maxToolCalls: MAX_AGENT_TOOL_CALLS,
      maxSearchCalls: MAX_AGENT_SEARCH_CALLS,
      maxReadChunks: MAX_READ_CHUNKS_PER_CALL,
      maxSourceCharacters: MAX_SOURCE_CHARACTERS,
      maxHistoryTurns: MAX_HISTORY_TURNS,
      maxHistoryCharacters: MAX_HISTORY_CHARACTERS,
      maxWebSearchCalls: MAX_WEB_SEARCH_CALLS,
      maxWebSources: MAX_WEB_SOURCES,
      webSummaryTokens: WEB_SEARCH_TOKEN_BUDGET,
      webPageSummaryTokens: WEB_SEARCH_PAGE_TOKEN_BUDGET,
    },
    retrieval,
    ingestion: { chunkCharacters: MAX_CHUNK_CHARACTERS, chunkingVersion: CHUNKING_VERSION, visualLimits },
    mode: process.env.APP_MODE ?? "未配置",
    codeVersion:
      process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.APP_CODE_VERSION ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    gatewayConfigured: Boolean(process.env.AI_GATEWAY_API_KEY),
    costBudget: null,
  };
  return {
    ...configuration,
    hash: createHash("sha256")
      .update(JSON.stringify(configuration))
      .digest("hex"),
  };
}
