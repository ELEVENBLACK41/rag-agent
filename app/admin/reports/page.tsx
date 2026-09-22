/** 修改时间：2026-09-22 | 文件说明：固定评测报告列表与尚未执行时的真实状态 | edit by：Sliye */
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
        尚未评测。固定 60 题数据集和命令行执行器已就绪，当前没有已生成报告。
      </p>
      <p className="mt-2 text-sm leading-7 text-muted-foreground">
        按 evals/classic/README.md 准备独立快照后运行 pnpm eval:run。没有完整证据标注的普通聊天 Run 不能据此计算召回率。
      </p>
    </MonitorPanel>
  );
}
