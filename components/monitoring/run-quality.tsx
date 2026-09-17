/** 修改时间：2026-09-17 | 文件说明：真实 Run 的已关联评测成绩和缺失标注说明 | edit by：Sliye */
import Link from "next/link";
import { listEvaluationReports } from "@/lib/monitoring/evaluation-reports";
import { MonitorPanel } from "@/components/monitoring/monitor-panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** @param runId 当前真实 Run 的标识；不把其他题目的成绩套用到本轮。 */
export async function RunQuality({ runId }: { runId: string }) {
  const result = await listEvaluationReports();
  const matches = result.reports.flatMap((report) => report.cases.filter((item) => item.runId === runId).map((item) => ({ report, item })));
  return <MonitorPanel title="质量评测（Recall@10 等）"><p className="mb-4 text-sm leading-7">真实 Run 可以关联评测结果，但要先有这道问题的相关资料标注。相似度和 rerank 分数只能反映排序，不能作为召回率。@10 指指定检索阶段的前 10 条；当前最终返回上限是 6，不能当作最终 Top 10。</p>
    {matches.length ? matches.map(({ report, item }) => <section key={`${report.id}:${item.id}`} className="mb-4 space-y-2"><Link href={`/admin/reports/${report.id}`} className="text-link underline">报告 {report.id} · 样本 {item.id}</Link><p className="text-xs text-muted-foreground">数据集 {report.datasetVersion} · 评分规则 {report.scorerVersion} · 配置 {report.configurationHash}</p><Table><TableHeader><TableRow><TableHead>指标</TableHead><TableHead>成绩</TableHead><TableHead>分子 / 分母</TableHead><TableHead>评分来源</TableHead></TableRow></TableHeader><TableBody>{Object.entries(item.metrics).map(([name, metric]) => <TableRow key={name}><TableCell>{name}</TableCell><TableCell>{metric.value ?? "未评分"} {metric.unit}</TableCell><TableCell>{metric.numerator ?? "—"} / {metric.denominator ?? "—"}</TableCell><TableCell>{{ deterministic: "规则计算", human: "人工评分", model: "模型评分（须复核）" }[metric.source]}</TableCell></TableRow>)}</TableBody></Table><p className="text-sm">{item.explanation}</p></section>) : <p className="mb-4 rounded-md bg-muted p-3 text-sm">未评测：当前扫描的报告中没有关联此 Run 的成绩。不会显示虚构分数，也不把未评分当 0。</p>}
    {result.truncated && <p className="text-sm">当前仅扫描最近文件名排序的 50 份报告，可能存在未展示的历史成绩。</p>}
    <Table><TableHeader><TableRow><TableHead>指标</TableHead><TableHead>回答什么问题</TableHead><TableHead>需要什么数据</TableHead></TableRow></TableHeader><TableBody>
      <TableRow><TableCell>Recall@10（召回率）</TableCell><TableCell>所有应找到的相关资料，前 10 条找到了多少？</TableCell><TableCell>固定资料范围内的完整相关性标注或明确的已标注池</TableCell></TableRow>
      <TableRow><TableCell>Precision@10（精确率）</TableCell><TableCell>前 10 条中有多少相关资料？</TableCell><TableCell>前 10 条的相关/不相关标注及固定分母口径</TableCell></TableRow>
      <TableRow><TableCell>RR / MRR</TableCell><TableCell>第一个相关结果排得多靠前？</TableCell><TableCell>首个相关结果的位置；RR 为单题，MRR 为多题平均</TableCell></TableRow>
      <TableRow><TableCell>nDCG@10</TableCell><TableCell>高相关资料是否排在前面？</TableCell><TableCell>相关性等级及该题的理想排序</TableCell></TableRow>
    </TableBody></Table>
  </MonitorPanel>;
}
