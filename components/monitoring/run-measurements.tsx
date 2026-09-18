/** 修改时间：2026-09-18 | 文件说明：以表格展示真实模型、工具和逐次检索数据，不混淆排序分数与质量评分 | edit by：Sliye */
import { z } from "zod";
import { formatUsd } from "@/lib/monitoring/gateway-cost";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MonitorPanel,
  durationLabel,
} from "@/components/monitoring/monitor-panel";
import type { getMonitorRun } from "@/lib/monitoring/repository";
import type { RetrievalTrace } from "@/lib/retrieval/types";

/** 数据库中旧的模型记录也可能尚无 usage，因此缺失值保持未知。 */
const modelSchema = z.object({
  costUsd: z.number().finite().nonnegative().nullable().optional(),
  phase: z.string(),
  status: z.string(),
  modelId: z.string().optional(),
  modelResponseMs: z.number().optional(),
  stepTimeMs: z.number().optional(),
  usage: z
    .object({
      inputTokens: z.number().nullable(),
      outputTokens: z.number().nullable(),
      totalTokens: z.number().nullable(),
      cacheReadTokens: z.number().nullable(),
      reasoningTokens: z.number().nullable(),
    })
    .nullable(),
});
const toolSchema = z.object({
  toolName: z.string(),
  status: z.string(),
  errorKind: z
    .enum([
      "tool-not-available",
      "invalid-tool-input",
      "tool-execution-error",
    ])
    .nullable()
    .optional(),
  resultStatus: z.string().nullable().optional(),
  resultCount: z.number().nullable(),
  observedDurationMs: z.number().nullable(),
});
/** 数据来自已校验的产品写入链路；保留旧 Trace，最低限度辨认是否为检索记录。 */
const traceSchema = z.object({
  keywordCandidateIds: z.array(z.string()),
  vectorCandidateIds: z.array(z.string()),
  fusedCandidateIds: z.array(z.string()),
  finalChunkIds: z.array(z.string()),
});

/** @param value 实际数值；未知值不能展示为 0。 */
function numberLabel(value: number | null | undefined) {
  return value == null
    ? "未采集"
    : value.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
}

/** 将脱敏错误类别转换为管理页可理解的原因，不展示 SDK 原始异常。 */
function toolResultLabel(tool: z.infer<typeof toolSchema>) {
  if (tool.resultStatus) return tool.resultStatus;
  if (tool.errorKind === "tool-not-available") return "工具当步不可用";
  if (tool.errorKind === "invalid-tool-input") return "工具参数无效";
  if (tool.errorKind === "tool-execution-error") return "工具执行异常";
  return "—";
}

/** @param detail 已鉴权的当前 Run 记录。 */
export function RunMeasurements({
  detail,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getMonitorRun>>>;
}) {
  const models = detail.observations
    .filter((item) => item.kind === "model")
    .flatMap((item) => {
      const parsed = modelSchema.safeParse(item.payload);
      return parsed.success ? [{ id: item.observationId, ...parsed.data }] : [];
    });
  const tools = detail.observations
    .filter((item) => item.kind === "tool")
    .flatMap((item) => {
      const parsed = toolSchema.safeParse(item.payload);
      return parsed.success ? [{ id: item.observationId, ...parsed.data }] : [];
    });
  const traces = detail.events
    .filter(
      (event) =>
        event.eventType === "retrieval_trace" &&
        traceSchema.safeParse(event.payload).success,
    )
    .map((event) => ({ id: event.id, trace: event.payload as RetrievalTrace }));
  return (
    <>
      <MonitorPanel title="模型用量与耗时">
        {models.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  "阶段 / 状态",
                  "模型",
                  "输入 Token",
                  "输出 Token",
                  "总 Token",
                  "缓存读取 / 推理",
                  "模型响应 / 整步耗时",
                  "Gateway 费用（USD）",
                ].map((label) => (
                  <TableHead key={label}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((model) => (
                <TableRow key={model.id}>
                  <TableCell>
                    {model.phase === "answer" ? "最终回答" : "资料收集"}
                    <br />
                    {model.status === "completed" ? "已返回" : "尚未返回用量"}
                  </TableCell>
                  <TableCell>{model.modelId ?? "未采集"}</TableCell>
                  <TableCell>{numberLabel(model.usage?.inputTokens)}</TableCell>
                  <TableCell>
                    {numberLabel(model.usage?.outputTokens)}
                  </TableCell>
                  <TableCell>{numberLabel(model.usage?.totalTokens)}</TableCell>
                  <TableCell>
                    {numberLabel(model.usage?.cacheReadTokens)} /{" "}
                    {numberLabel(model.usage?.reasoningTokens)}
                  </TableCell>
                  <TableCell>
                    {durationLabel(model.modelResponseMs ?? null)} /{" "}
                    {durationLabel(model.stepTimeMs ?? null)}
                  </TableCell>
                  <TableCell>{formatUsd(model.costUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">
            此 Run 尚无模型用量记录；旧记录无法补算。
          </p>
        )}
      </MonitorPanel>
      <MonitorPanel title="工具执行">
        {tools.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                {["工具", "执行状态", "返回状态", "结果数量", "事件间隔"].map(
                  (label) => (
                    <TableHead key={label}>{label}</TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tools.map((tool) => (
                <TableRow key={tool.id}>
                  <TableCell>{tool.toolName}</TableCell>
                  <TableCell>
                    {tool.status === "completed"
                      ? "已返回"
                      : tool.status === "failed"
                        ? "失败"
                        : "已开始"}
                  </TableCell>
                  <TableCell>{toolResultLabel(tool)}</TableCell>
                  <TableCell>{numberLabel(tool.resultCount)}</TableCell>
                  <TableCell>
                    {durationLabel(tool.observedDurationMs)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">
            没有已采集的工具观测；旧工具活动仍可在原始记录查看。
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          返回成功只表示工具返回了结果，不表示答案正确。事件间隔不是供应商内部执行耗时。
        </p>
      </MonitorPanel>
      <MonitorPanel title="逐次检索与排名分数">
        {traces.length ? (
          traces.map(({ id, trace }, index) => (
            <RetrievalMeasurement key={id} trace={trace} ordinal={index + 1} />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            没有可用的检索记录；普通交流可能不需要检索。
          </p>
        )}
      </MonitorPanel>
    </>
  );
}

/** @param trace 一次真实检索。 @param ordinal 在当前 Run 中的检索顺序。 */
function RetrievalMeasurement({
  trace,
  ordinal,
}: {
  trace: RetrievalTrace;
  ordinal: number;
}) {
  const execution = trace.execution;
  const ids = [
    ...new Set([
      ...trace.keywordCandidateIds,
      ...trace.vectorCandidateIds,
      ...trace.fusedCandidateIds,
      ...trace.finalChunkIds,
    ]),
  ];
  return (
    <section className="space-y-3 border-b py-4">
      <h3 className="font-medium">第 {ordinal} 次检索</h3>
      <p className="text-sm">
        关键词候选 {trace.keywordCandidateIds.length} · 向量候选{" "}
        {trace.vectorCandidateIds.length} · 融合候选{" "}
        {trace.fusedCandidateIds.length} · 最终返回 {trace.finalChunkIds.length}
      </p>
      <p className="text-sm text-muted-foreground">
        关键词：{durationLabel(execution?.keywordMs ?? null)}；向量：
        {durationLabel(execution?.vectorMs ?? null)}；融合：
        {durationLabel(execution?.fusionMs ?? null)}；重排序：
        {durationLabel(trace.rerank.durationMs)}；总计：
        {durationLabel(execution?.durationMs ?? null)}。查询向量 Token：
        {numberLabel(execution?.embedding?.tokens)}。
      </p>
      <p className="text-sm">
        向量检索：{trace.vectorStatus === "completed" ? "完成" : "已降级"}
        ；重排序：
        {trace.rerank.status === "completed"
          ? "完成"
          : `回退（${trace.rerank.reason}）`}
      </p>
      <p className="text-xs text-muted-foreground">
        这些是排序分数，不是 Recall
        或正确率。关键词/向量/融合均保留各自排名；重排序只返回最终候选，缺失分数不补零。
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            {[
              "片段 ID",
              "关键词排名",
              "向量排名 / 相似度",
              "融合排名 / RRF",
              "最终排名 / rerank",
            ].map((label) => (
              <TableHead key={label}>{label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {ids.map((id) => {
            const vector = execution?.vector.find(
              (item) => item.chunkId === id,
            );
            const fused = execution?.fused.find((item) => item.chunkId === id);
            const final = execution?.final.find((item) => item.chunkId === id);
            const rank = (list: string[]) => {
              const position = list.indexOf(id);
              return position < 0 ? "未入选" : position + 1;
            };
            return (
              <TableRow key={id}>
                <TableCell className="max-w-40 break-all font-mono text-xs">
                  {id}
                </TableCell>
                <TableCell>{rank(trace.keywordCandidateIds)}</TableCell>
                <TableCell>
                  {rank(trace.vectorCandidateIds)} /{" "}
                  {numberLabel(vector?.similarity)}
                </TableCell>
                <TableCell>
                  {rank(trace.fusedCandidateIds)} /{" "}
                  {numberLabel(fused?.rrfScore)}
                </TableCell>
                <TableCell>
                  {rank(trace.finalChunkIds)} /{" "}
                  {numberLabel(final?.rerankScore)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
