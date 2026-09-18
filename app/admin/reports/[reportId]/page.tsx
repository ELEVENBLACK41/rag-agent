/** 修改时间：2026-09-17 | 文件说明：已有评测报告的版本和逐题结果查看 | edit by：Sliye */
import Link from "next/link";
import { notFound } from "next/navigation";
import { isOwner } from "@/lib/auth/owner";
import {
  readEvaluationReport,
  reportIdSchema,
} from "@/lib/monitoring/evaluation-reports";
import {
  MonitorPanel,
  ObservationJson,
} from "@/components/monitoring/monitor-panel";

/** @param params 只接受固定目录中的安全报告 ID。 */
export default async function EvaluationReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  if (!(await isOwner())) return null;
  const id = reportIdSchema.safeParse((await params).reportId);
  if (!id.success) notFound();
  const report = await readEvaluationReport(id.data);
  if (!report) notFound();
  const { cases, ...version } = report;
  return (
    <>
      <MonitorPanel title="报告版本">
        <ObservationJson value={version} />
      </MonitorPanel>
      <MonitorPanel title="逐题结果">
        {cases.map((item) => (
          <details key={item.id} className="border-b py-3">
            <summary className="cursor-pointer text-sm">
              {item.id} · {item.status}
            </summary>
            <ObservationJson value={item} />
            {item.runId && (
              <Link
                className="text-link underline"
                href={`/admin/runs/${item.runId}`}
              >
                查看实际运行
              </Link>
            )}
          </details>
        ))}
      </MonitorPanel>
    </>
  );
}
