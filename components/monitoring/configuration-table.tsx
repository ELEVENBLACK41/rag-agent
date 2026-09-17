/** 修改时间：2026-09-17 | 文件说明：当前及历史配置的中文名称、单位与语义说明 | edit by：Sliye */
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** 配置键对应中文名称、单位、说明；数值仍从实际快照读取。 */
const fields: Record<string, [string, string, string]> = {
  version: ["配置格式版本", "—", "用于识别配置快照的数据格式"],
  model: ["聊天模型", "模型 ID", "资料收集与最终回答使用的模型"],
  maxSteps: ["最多模型步骤", "步 / Run", "一次问答最多执行多少个收集阶段模型步骤"],
  stepOutputTokens: ["每步输出上限", "Token", "收集阶段单次模型输出预算"],
  answerOutputTokens: ["最终回答输出上限", "Token", "最终回答生成阶段的输出预算"],
  deadlineMs: ["问答总时限", "毫秒", "包含排队时间；120,000 毫秒等于 120 秒"],
  maxToolCalls: ["工具调用预算", "次 / Run", "本地工具门禁与模型步骤边界使用的总预算；非供应商内部调用上限"],
  maxSearchCalls: ["知识库搜索上限", "次 / Run", "搜索与关联检索共用预算"],
  maxReadChunks: ["单次读取片段上限", "块", "每次读取工具可返回的最大 Chunk 数"],
  maxSourceCharacters: ["单片段上下文上限", "字符", "交给模型的单条证据最大字符数"],
  maxHistoryTurns: ["历史问答轮数上限", "轮", "最多携带最近完整问答轮数"],
  maxHistoryCharacters: ["历史上下文预算", "字符", "历史正文字符预算，不等于 Token 数"],
  maxWebSearchCalls: ["联网搜索预算", "次 / Run", "模型步骤之间检查，不代表供应商内部请求次数"],
  maxWebSources: ["网页来源展示上限", "条", "每条回答最多展示的去重网页来源"],
  webSummaryTokens: ["搜索摘要总预算", "Token", "单次联网搜索返回摘要的总预算"],
  webPageSummaryTokens: ["单页摘要预算", "Token", "每个网页的摘要预算，不是全文抓取"],
  EMBEDDING_MODEL: ["查询向量模型", "模型 ID", "把检索问题转为向量的模型"],
  EMBEDDING_DIMENSIONS: ["向量维度", "维", "须与已建索引向量维度一致"],
  RERANK_MODEL: ["重排序模型", "模型 ID", "对融合候选进一步排序"],
  RETRIEVAL_CANDIDATE_LIMIT: ["单路初始候选上限", "块", "关键词和向量两路各自的候选数量上限"],
  RERANK_CANDIDATE_LIMIT: ["重排序候选上限", "块", "融合后最多送入 rerank 的候选数"],
  FINAL_RETRIEVAL_LIMIT: ["最终检索 Top K", "块", "一次检索最终返回的最大片段数；当前 Top 6 不等于 Top 10"],
  RRF_RANK_CONSTANT: ["排名融合平滑常数", "—", "RRF 的排名平滑参数，不是相关性分数"],
  RERANK_TIMEOUT_MS: ["重排序超时", "毫秒", "超时后回退到融合顺序"],
  chunkCharacters: ["切块目标预算", "字符", "按格式边界切块；不是 Token 数或严格物理长度"],
  chunkingVersion: ["切块策略版本", "版本", "识别本次格式感知切块策略"],
  MAX_VISUAL_ASSETS_PER_IMPORT_BATCH: ["每批视觉资产上限", "张", "跨 PDF 页和 Office 图片累计"],
  MAX_VISUAL_CANDIDATES_PER_FILE: ["单文件视觉候选上限", "张", "单份文档可送入视觉分析的候选上限"],
  MIN_VISUAL_IMAGE_EDGE_PIXELS: ["视觉图片最小边长", "像素", "小于该边长的图片不做视觉分析"],
  MAX_VISUAL_IMAGE_PIXELS: ["视觉图片最大像素数", "像素", "单张送入模型的图片像素预算"],
  PDF_RENDER_MAX_EDGE_PIXELS: ["PDF 渲染最长边", "像素", "只影响 PDF 页面的渲染图"],
  PDF_RENDER_DEFAULT_SCALE: ["PDF 默认渲染倍率", "倍", "PDF 页面转图片时的默认倍率"],
  mode: ["运行模式", "—", "当前服务端的部署模式"],
  codeVersion: ["代码版本", "提交 ID", "缺少环境变量时保持未采集"],
  deploymentId: ["部署标识", "ID", "部署平台提供，本地可为空"],
  gatewayConfigured: ["模型网关密钥", "—", "只显示是否配置，绝不显示密钥内容"],
  costBudget: ["金额预算", "USD", "当前尚未接入金额预算；步骤和 Token 上限不等同于费用上限"],
  hash: ["配置指纹", "SHA-256", "用于对比两次运行的配置是否一致"],
};

/** @param value 当前配置或历史快照，不用当前值填补旧快照。 */
export function ConfigurationTable({ value }: { value: Record<string, unknown> }) {
  const rows: Array<{ path: string; key: string; value: unknown }> = [];
  /** @param object 当前配置层。 @param prefix 仅用于保留原始字段定位。 */
  function collect(object: Record<string, unknown>, prefix = "") {
    for (const [key, entry] of Object.entries(object)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) collect(entry as Record<string, unknown>, path);
      else rows.push({ path, key, value: entry });
    }
  }
  collect(value);
  return <Table><TableHeader><TableRow><TableHead>配置项</TableHead><TableHead>实际值</TableHead><TableHead>单位</TableHead><TableHead>含义</TableHead></TableRow></TableHeader>
    <TableBody>{rows.map((row) => {
      const [label, unit, description] = fields[row.key] ?? [row.key, "—", "保留该快照的原始字段"];
      const display = row.value == null ? "未配置 / 未采集" : typeof row.value === "boolean" ? row.value ? "已配置" : "未配置" : typeof row.value === "number" ? row.value.toLocaleString("zh-CN") : String(row.value);
      return <TableRow key={row.path}><TableCell className="min-w-44"><span>{label}</span><span className="mt-1 block text-xs text-muted-foreground">{row.key}</span></TableCell><TableCell className="max-w-64 break-all font-mono text-xs">{display}</TableCell><TableCell className="whitespace-nowrap">{unit}</TableCell><TableCell className="min-w-52 text-muted-foreground">{description}</TableCell></TableRow>;
    })}</TableBody></Table>;
}
