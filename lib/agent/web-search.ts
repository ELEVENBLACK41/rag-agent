/** 修改时间：2026-09-17 | 文件说明：主模型搜索结果的校验、去重和回答来源选择 | edit by：Sliye */
import { z } from "zod";
import type { WebSource } from "@/lib/chat/types";

/** 每条回答最多展示的真实网页来源数。 */
export const MAX_WEB_SOURCES = 5;
/** 模型步骤之间检查搜索次数，达到阈值后不再开放搜索工具。 */
export const MAX_WEB_SEARCH_CALLS = 2;
/** 单次搜索返回摘要的总 Token 预算。 */
export const WEB_SEARCH_TOKEN_BUDGET = 3_000;
/** 单页摘要 Token 预算，不代表抓取全文。 */
export const WEB_SEARCH_PAGE_TOKEN_BUDGET = 600;
/** 只读取业务需要的供应商结果字段；错误或格式异常不能冒充无结果。 */
const searchResultSchema = z.object({
  results: z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string() })),
});
/** 搜索摘要是证据，不表示应用读取过完整网页。 */
type WebEvidence = WebSource & { snippet: string };

/** @param url 外部搜索返回的链接；拒绝脚本、凭据 URL 和非网页协议。 */
export function normalizeWebUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

/** 每轮独立保存主模型实际收到的搜索结果，不发网络请求或调用模型。 */
export function createWebSearchEvidence() {
  /** URL 去重后分配稳定编号，供最终回答选择。 */
  const evidence = new Map<string, WebEvidence>();
  return {
    /** @param output Gateway 的真实 tool-result；供应商错误和格式异常均标记失败。 */
    collect(output: unknown) {
      const parsed = searchResultSchema.safeParse(output);
      if (!parsed.success) return "failed" as const;
      let count = 0;
      for (const item of parsed.data.results) {
        const url = normalizeWebUrl(item.url);
        if (!url) continue;
        count += 1;
        if (!evidence.has(url) && evidence.size < MAX_WEB_SOURCES * MAX_WEB_SEARCH_CALLS) {
          evidence.set(url, { id: evidence.size + 1, url, title: item.title.slice(0, 300) || new URL(url).hostname, snippet: item.snippet.slice(0, 2_400) });
        }
      }
      return count ? "searched" as const : "no-results" as const;
    },
    getEvidence: () => [...evidence.values()],
    /** @param ids 最终回答实际使用的来源编号；未知编号拒绝发布。 */
    selectSources(ids: number[]): WebSource[] {
      const selected = [...new Set(ids)];
      if (selected.length > MAX_WEB_SOURCES) throw new Error("网页来源数量超出上限。");
      return selected.map((id) => {
        const source = [...evidence.values()].find((entry) => entry.id === id);
        if (!source) throw new Error("回答包含未经搜索验证的网页来源。");
        return { id: source.id, title: source.title, url: source.url };
      });
    },
  };
}

export type WebSearchEvidence = ReturnType<typeof createWebSearchEvidence>;
