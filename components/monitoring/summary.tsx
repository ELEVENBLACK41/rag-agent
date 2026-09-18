/** 修改时间：2026-09-17 | 文件说明：带样本和覆盖率的运行汇总 | edit by：Sliye */
import type { summarizeRuns } from "@/lib/monitoring/statistics";
import { durationLabel } from "@/components/monitoring/monitor-panel";
import { formatUsd } from "@/lib/monitoring/gateway-cost";

/** @param summary 当前筛选样本统计。 */
export function RunSummary({
  summary: s,
}: {
  summary: ReturnType<typeof summarizeRuns>;
}) {
  const items = [
    ["Run 数量", s.sampleCount],
    [
      "完成 / 失败 / 取消 / 执行中",
      `${s.completed} / ${s.failed} / ${s.cancelled} / ${s.running}`,
    ],
    [
      "总耗时 p50 / p95",
      `${durationLabel(s.p50Ms)} / ${durationLabel(s.p95Ms)}`,
    ],
    ["已采集模型步骤", s.modelCalls],
    ["已知 Token 小计", s.totalTokens ?? "未采集"],
    ["用量覆盖（已知 / 已记录步骤）", `${s.knownUsageCalls} / ${s.modelCalls}`],
    ["Gateway 已知费用小计（USD）", formatUsd(s.costUsd)],
    ["费用覆盖（已知 / 已记录步骤）", `${s.knownCostCalls} / ${s.modelCalls}`],
  ];
  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label} className="border-l-2 border-border pl-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-lg font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-xs leading-6 text-muted-foreground">
        耗时包含排队；分位数采用 nearest-rank，覆盖 {s.durationSampleCount}{" "}
        个已有终态的 Run（包含失败和取消）。Token 仅统计已有观测的模型步骤，旧
        Run 和未返回用量的请求不视为零；不含导入与查询向量用量。
        费用仅汇总聊天模型步骤的 Gateway 返回金额；缺失步骤、独立导入、Embedding 和 rerank 费用未纳入，不代表完整平台账单。
      </p>
    </>
  );
}
