/**
 * 修改时间：2026-09-18
 * 文件说明：知识库与获准联网搜索工具的统一注册入口。
 *
 * 本地工具只访问当前 Run 固定快照，且读取前必须来自本次搜索候选。
 * 联网工具按本轮授权注册，由 Gateway 执行；不提供文件写入、Shell 或无界全库读取能力。
 *
 * AI SDK 工具文档：https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
 *
 * edit by：Sliye
 */

import { gateway, tool } from "ai";
import { MAX_WEB_SOURCES, WEB_SEARCH_TOKEN_BUDGET, WEB_SEARCH_PAGE_TOKEN_BUDGET } from "@/lib/agent/web-search";
import { z } from "zod";
import { retrievePublishedChunksWithTrace } from "@/lib/retrieval/search";
import { readSnapshotSources } from "@/lib/sources/reader";
import { FILE_LIST_PAGE_SIZE, readFileInventory } from "@/lib/sources/file-inventory";
import type { SourceCitation } from "@/lib/sources/types";
import {
  MAX_READ_CHUNKS_PER_CALL,
  MAX_SOURCE_CHARACTERS,
  type VaultRunState,
} from "@/lib/agent/run-state";

/** 创建绑定当前 Run 状态的只读工具及证据收集结束工具。
 * @param state 本次执行的来源授权与预算。
 * @param assertActive 每次启动工具前检查持久取消状态，不能仅依赖浏览器或模型信号。
 * @param webSearchEnabled 本轮是否允许主模型直接调用 Gateway 搜索。
 */
export function createVaultTools(state: VaultRunState, assertActive: () => Promise<void>, webSearchEnabled = false) {
  return {
    // 官方：https://vercel.com/docs/ai-gateway/models-and-providers/web-search
    // 供应商执行工具直接交给主模型；配置默认结果数和摘要预算，不另套 generateText。
    ...(webSearchEnabled
      ? {
          search_web: gateway.tools.perplexitySearch({
            maxResults: MAX_WEB_SOURCES,
            maxTokens: WEB_SEARCH_TOKEN_BUDGET,
            maxTokensPerPage: WEB_SEARCH_PAGE_TOKEN_BUDGET,
          }),
        }
      : {}),
    list_files: tool({
      description:
        "仅在用户要求查看知识库文件名称、数量、清单，或具体资料任务需要先确认文件身份时调用。纯问候、寒暄、致谢不能调用，不主动给用户展示知识库。返回当前已发布快照的文件名、相对路径、格式和文件总数，不返回正文。若目标是介绍或概括文件，清单只能确定文件身份，之后仍须搜索候选并在下一步读取正文。已从上下文明确目标文件时可直接搜索，不必重复列清单。总数以返回值为准，每页最多 30 个；完整清单且 nextOffset 非空时在预算内继续翻页，未读全须说明范围。",
      inputSchema: z.object({ //z来自Zod数据校验库,这个工具接受一个对象,必须有briefing,offset
        briefing: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            "公开阶段说明：准备查询文件清单或继续列取下一页，1 至 2 句",
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER - FILE_LIST_PAGE_SIZE)
          .describe("分页起点，首次传 0；后续使用上次结果的 nextOffset"),
      }),
      strict: true,
      execute: async ({ offset }) => {
        await assertActive();
        if (!state.beginToolCall()) return { status: "tool-budget-exhausted" };
        if (!state.snapshotId)
          return { status: "empty-vault", message: "当前尚无已发布资料。" };
        const inventory = await readFileInventory(state.snapshotId, [offset]);
        state.recordFileList(offset);
        return {
          status: "listed",
          ...inventory,
          offset,
          nextOffset:
            offset + FILE_LIST_PAGE_SIZE < inventory.totalCount
              ? offset + FILE_LIST_PAGE_SIZE
              : null,
        };
      },
    }),
    search_notes: tool({
      description:
        "在当前知识库快照中搜索正文候选。query 保留用户原意，不静默纠正疑似错词；表达可能错漏、宽泛或多义时，可在 queryVariants 提供最多两个检索假设，它们只扩展召回，不代表已确认用户意图。用户提供文件名、路径或宽泛文件描述时放入 fileHint，它只参与排序，不限制检索范围。当前问题承接近期对话时，先恢复完整对象，不能只搜索代词或历史结论。返回候选后须在下一步读取正文。",
      inputSchema: z.object({
        briefing: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            "展示给用户的公开阶段说明：准备搜索什么、为什么搜索，1 至 2 句，不写最终结论",
          ),
        query: z
          .string()
          .trim()
          .min(1)
          .max(600)
          .describe("保留用户原意并补全上下文后的主检索问题"),
        queryVariants: z
          .array(z.string().trim().min(1).max(600))
          .max(2)
          .optional()
          .describe("疑似错漏或多义时的检索假设，最多两个；无合理假设时省略"),
        fileHint: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .describe("用户提供的文件名、路径或宽泛文件描述；未提供时省略"),
      }),
      strict: true,
      execute: async ({ query, queryVariants, fileHint }, { abortSignal }) => {
        await assertActive();
        if (!state.beginToolCall()) return { status: "tool-budget-exhausted" };
        if (!state.snapshotId)
          return {
            status: "empty-vault",
            message: "请先导入资料。",
            matches: [],
          };
        const blocked = state.beginSearch(
          [query, ...(queryVariants ?? []), fileHint]
            .filter(Boolean)
            .join("\n"),
        );
        if (blocked)
          return {
            status: blocked,
            message: "请使用已有候选或说明证据缺口。",
            matches: [],
          };
        const result = await retrievePublishedChunksWithTrace(
          state.snapshotId,
          query,
          { abortSignal, queryVariants, fileHint },
        );
        await state.recordRetrievalTrace(result.trace);
        state.permitChunks(result.chunks.map((chunk) => chunk.chunkId));
        return {
          status: "searched",
          matches: result.chunks.map((chunk) => ({
            chunkId: chunk.chunkId,
            title: chunk.displayName,
            location: describeLocation(chunk),
          })),
        };
      },
    }),
    read_sources: tool({
      description:
        "读取搜索结果中的少量来源片段，并获得可用于最终回答的引用编号。",
      inputSchema: z.object({
        briefing: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            "展示给用户的公开阶段说明：准备核对哪些证据，1 至 2 句，不写最终结论",
          ),
        chunkIds: z
          .array(z.string().uuid())
          .min(1)
          .max(MAX_READ_CHUNKS_PER_CALL)
          .describe(
            "必须来自 search_notes 或 find_related 返回结果的 Chunk ID",
          ),
      }),
      strict: true,
      execute: async ({ chunkIds }) => {
        await assertActive();
        if (!state.beginToolCall()) return { status: "tool-budget-exhausted" };
        if (!state.snapshotId)
          return { status: "empty-vault", message: "请先导入资料。" };
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
      description:
        "基于已搜索到的一个来源片段，在当前快照中查找相关资料或补充证据。",
      inputSchema: z.object({
        briefing: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            "展示给用户的公开阶段说明：当前证据缺少什么、为何继续关联检索，1 至 2 句",
          ),
        chunkId: z.string().uuid().describe("来自此前搜索结果的 Chunk ID"),
      }),
      strict: true,
      execute: async ({ chunkId }, { abortSignal }) => {
        await assertActive();
        if (!state.beginToolCall()) return { status: "tool-budget-exhausted" };
        if (!state.snapshotId)
          return {
            status: "empty-vault",
            message: "请先导入资料。",
            matches: [],
          };
        state.assertReadable([chunkId]);
        const blocked = state.beginSearch(`related:${chunkId}`);
        if (blocked)
          return {
            status: blocked,
            message: "请使用已有候选或说明证据缺口。",
            matches: [],
          };
        const [source] = await readSnapshotSources(state.snapshotId, [chunkId]);
        if (!source) throw new Error("关联来源已不可读取，请重新搜索。");
        const result = await retrievePublishedChunksWithTrace(
          state.snapshotId,
          truncateSourceContent(source.content),
          { abortSignal },
        );
        await state.recordRetrievalTrace(result.trace);
        state.permitChunks(result.chunks.map((chunk) => chunk.chunkId));
        return {
          status: "searched",
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
      description:
        "仅在本轮用户目标已有足够证据，或实际尝试后因无结果、工具失败、预算限制无法继续时交接最终生成。仅列文件时文件清单即可；介绍或概括内容时，只有清单、尚未尝试搜索/读取不能结束。读取过资料也不代表证据充分；普通交流不要调用。",
      inputSchema: z.object({
        briefing: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            "证据交接记录，1 至 2 句：只写原始问题已确认的范围及尚未解决的缺口；问题已解决就结束。不重复完整答案或文件清单，不建议额外查询，不写‘如需了解’、‘请提供’等邀请追问或服务收尾",
          ),
      }),
      strict: true,
      execute: async () => {
        await assertActive();
        if (!state.beginToolCall()) return { status: "tool-budget-exhausted" };
        return {
          status: state.getCitationCount()
            ? "sources-read"
            : state.getFileListOffsets().length
              ? "file-metadata-read"
              : "no-sources-read",
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
  if (source.sourceLocator?.format === "markdown-visual")
    return `第 ${source.sourceLocator.lineNumber} 行 · 图片 ${source.sourceLocator.attachmentPath} · 视觉分析`;
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
