/** 修改时间：2026-09-17 | 文件说明：评测尚未执行时的真实管理状态，执行与报告接入归属 D15 | edit by：Sliye */
import { isOwner } from "@/lib/auth/owner";
import { MonitorPanel } from "@/components/monitoring/monitor-panel";
import Link from "next/link";
import { listEvaluationReports } from "@/lib/monitoring/evaluation-reports";

/** 未产出评测报告时不展示虚构质量分数或样本。 */
export default async function ReportsPage() {
  if (!(await isOwner())) return null;
  const result = await listEvaluationReports();
  if (result.reports.length) return <MonitorPanel title="评测报告"><ul className="space-y-3">{result.reports.map((report) => <li key={report.id}><Link className="text-link underline" href={`/admin/reports/${report.id}`}>{report.id}</Link><p className="text-xs text-muted-foreground">{report.createdAt} · {report.datasetVersion} · {report.cases.length} 个样本</p></li>)}</ul>{result.truncated && <p>当前按文件名降序展示最多 50 个报告。</p>}</MonitorPanel>;
  return (
    <MonitorPanel title="评测报告">
      <p className="text-sm leading-7">
        尚未评测。当前没有标准评测集、执行器或已生成报告。
      </p>
      <p className="mt-2 text-sm leading-7 text-muted-foreground">
        固定评测命令、报告存储与基线对比安排在
        D15。运行监控数据可用于排查耗时与失败，但不能据此计算回答正确率或检索召回率。
      </p>
    </MonitorPanel>
  );
}
