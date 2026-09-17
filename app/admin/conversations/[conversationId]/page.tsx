/*
 * @Author: shaoliye shaoliye@fengmap.com
 * @Date: 2026-09-17 15:17:48
 * @LastEditors: shaoliye shaoliye@fengmap.com
 * @LastEditTime: 2026-09-17 15:31:33
 * @FilePath: \rag-agent\app\admin\conversations\[conversationId]\page.tsx
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
/** 修改时间：2026-09-17 | 文件说明：指定会话的运行汇总与详情入口 | edit by：Sliye */
import { notFound } from "next/navigation";
import { isOwner } from "@/lib/auth/owner";
import {
  getMonitorRuns,
  monitorFilterSchema,
} from "@/lib/monitoring/repository";
import { summarizeRuns } from "@/lib/monitoring/statistics";
import { RunTable } from "@/components/monitoring/run-table";
import { RunSummary } from "@/components/monitoring/summary";
import { MonitorPanel } from "@/components/monitoring/monitor-panel";

/** @param params 指定会话标识，页面本身执行权限校验。 */
export default async function ConversationMonitorPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  if (!(await isOwner())) return null;
  const parsed = monitorFilterSchema.safeParse({
    ...(await params),
    hours: 720,
  });
  if (!parsed.success) notFound();
  const result = await getMonitorRuns(parsed.data);
  return (
    <>
      <h2 className="text-xl font-medium">
        {result.runs[0]?.title ?? "会话运行"}
      </h2>
      <p className="text-xs text-muted-foreground">
        最近 30 天，最多 100 个 Run；不是会话全生命周期统计。
        {result.truncated ? "当前结果已截断。" : ""}
      </p>
      <MonitorPanel title="会话汇总">
        <RunSummary summary={summarizeRuns(result.runs, result.observations)} />
      </MonitorPanel>
      <MonitorPanel title="各次运行">
        <RunTable rows={result.runs} observations={result.observations} />
      </MonitorPanel>
    </>
  );
}
