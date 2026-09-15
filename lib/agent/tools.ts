/**
 * 修改时间：2026-09-15
 * 文件说明：VaultAgent D9 只读知识库 Agent 工具定义。
 *
 * 工具只访问当前 Run 固定快照，且读取前必须来自本次搜索候选。不会提供文件写入、
 * 网络请求、Shell 或无界全库读取能力。
 *
 * AI SDK 工具文档：https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
 *
 * edit by：Sliye
 */

import { tool } from "ai";
import { z } from "zod";
import { retrievePublishedChunksWithTrace } from "@/lib/retrieval/search";
import { readSnapshotSources } from "@/lib/sources/reader";
import type { SourceCitation } from "@/lib/sources/types";
import {
  MAX_READ_CHUNKS_PER_CALL,
  MAX_SOURCE_CHARACTERS,
  type VaultRunState,
} from "@/lib/agent/run-state";

/** 创建绑定当前 Run 状态的三项只读工具。 */
export function createVaultTools(state: VaultRunState) {
  return {
    search_notes: tool({
      description: "在当前知识库快照中搜索与问题相关的内容候选。需要文档事实或证据时使用；问候、致谢无需调用，也不能用搜索结果代替完整文件清单。",
      inputSchema: z.object({
        briefing: z.string().trim().min(1).max(200)
          .describe("展示给用户的公开阶段说明：准备搜索什么、为什么搜索，1 至 2 句，不写最终结论"),
        query: z.string().trim().min(1).max(600).describe("用于检索知识库的具体问题"),
      }),
      strict: true,
      execute: async ({ query }) => {
        state.beginToolCall();
        const result = await retrievePublishedChunksWithTrace(state.snapshotId, query);
        await state.recordRetrievalTrace(result.trace);
        state.permitChunks(result.chunks.map((chunk) => chunk.chunkId));
        return {
          matches: result.chunks.map((chunk) => ({
            chunkId: chunk.chunkId,
            title: chunk.displayName,
            location: describeLocation(chunk),
          })),
        };
      },
    }),
    read_sources: tool({
      description: "读取搜索结果中的少量来源片段，并获得可用于最终回答的引用编号。",
      inputSchema: z.object({
        briefing: z.string().trim().min(1).max(200)
          .describe("展示给用户的公开阶段说明：准备核对哪些证据，1 至 2 句，不写最终结论"),
        chunkIds: z.array(z.string().uuid()).min(1).max(MAX_READ_CHUNKS_PER_CALL)
          .describe("必须来自 search_notes 或 find_related 返回结果的 Chunk ID"),
      }),
      strict: true,
      execute: async ({ chunkIds }) => {
        state.beginToolCall();
        state.assertReadable(chunkIds);
        const sources = await readSnapshotSources(state.snapshotId, chunkIds);
        if (sources.length !== chunkIds.length)
          throw new Error("部分来源已不可读取，请重新搜索。");
        return {
          sources: sources.map((source) => {
            const citation = state.addCitation(toCitation(source));
            return {
              citationId: citation.id,
              title: citation.displayName,
              location: describeLocation(citation),
              content: truncateSourceContent(source.content),
            };
          }),
        };
      },
    }),
    find_related: tool({
      description: "基于已搜索到的一个来源片段，在当前快照中查找相关资料或补充证据。",
      inputSchema: z.object({
        briefing: z.string().trim().min(1).max(200)
          .describe("展示给用户的公开阶段说明：当前证据缺少什么、为何继续关联检索，1 至 2 句"),
        chunkId: z.string().uuid().describe("来自此前搜索结果的 Chunk ID"),
      }),
      strict: true,
      execute: async ({ chunkId }) => {
        state.beginToolCall();
        state.assertReadable([chunkId]);
        const [source] = await readSnapshotSources(state.snapshotId, [chunkId]);
        if (!source) throw new Error("关联来源已不可读取，请重新搜索。");
        const result = await retrievePublishedChunksWithTrace(
          state.snapshotId,
          truncateSourceContent(source.content),
        );
        await state.recordRetrievalTrace(result.trace);
        state.permitChunks(result.chunks.map((chunk) => chunk.chunkId));
        return {
          matches: result.chunks
            .filter((chunk) => chunk.chunkId !== chunkId)
            .map((chunk) => ({
              chunkId: chunk.chunkId,
              title: chunk.displayName,
              location: describeLocation(chunk),
            })),
        };
      },
    }),
    finish_research: tool({
      description: "证据已经足够或本地资料确实不足时结束检索阶段，随后由独立生成器输出最终回答。",
      inputSchema: z.object({
        briefing: z.string().trim().min(1).max(200)
          .describe("展示给用户的公开阶段结论：已确认了什么、仍缺少什么，1 至 2 句，不直接写完整答案"),
      }),
      strict: true,
      execute: async () => {
        state.beginToolCall();
        return {
          status: state.getCitationCount() ? "evidence-ready" : "insufficient-evidence",
          citationCount: state.getCitationCount(),
        };
      },
    }),
  };
}

/** 截断模型上下文中的正文，不影响用户打开完整、受鉴权的来源预览。 */
function truncateSourceContent(content: string) {
  return content.slice(0, MAX_SOURCE_CHARACTERS);
}

/** 将来源定位压缩为工具结果中可供模型选择的短说明。 */
function describeLocation(source: {
  startLine: number | null;
  endLine: number | null;
  sourceLocator: SourceCitation["sourceLocator"];
}) {
  if (source.sourceLocator?.format === "pdf") return `第 ${source.sourceLocator.pageNumber} 页`;
  if (source.sourceLocator?.format === "pdf-visual") return `第 ${source.sourceLocator.pageNumber} 页 · 视觉分析`;
  if (source.sourceLocator?.format === "docx")
    return source.sourceLocator.blockType === "table"
      ? `表格 ${source.sourceLocator.tableIndex ?? source.sourceLocator.blockIndex}`
      : `段落 ${source.sourceLocator.blockIndex}`;
  if (source.sourceLocator?.format === "docx-visual") return `内嵌图片 ${source.sourceLocator.imageIndex}`;
  if (source.sourceLocator?.format === "xlsx") return `${source.sourceLocator.sheetName} · ${source.sourceLocator.range}`;
  if (source.sourceLocator?.format === "xlsx-visual") return `${source.sourceLocator.sheetName} · ${source.sourceLocator.anchor} · 图片 ${source.sourceLocator.imageIndex}`;
  if (source.startLine !== null && source.endLine !== null)
    return `第 ${source.startLine}-${source.endLine} 行`;
  return "位置不可用";
}

/** 从 Agent 读取结果中构造稳定的用户可见引用。 */
function toCitation(source: Awaited<ReturnType<typeof readSnapshotSources>>[number]) {
  return {
    chunkId: source.chunkId,
    displayName: source.displayName,
    startLine: source.startLine,
    endLine: source.endLine,
    sourceLocator: source.sourceLocator,
  };
}
