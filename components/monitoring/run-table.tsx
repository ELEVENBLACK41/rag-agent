/** 修改时间：2026-09-17 | 文件说明：可定位会话和 Run 的管理列表 | edit by：Sliye */
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { durationLabel } from "@/components/monitoring/monitor-panel";
import type { getMonitorRuns } from "@/lib/monitoring/repository";
import { summarizeRuns } from "@/lib/monitoring/statistics";
import { formatUsd } from "@/lib/monitoring/gateway-cost";

/** @param rows 服务端已经按权限和筛选范围读取的运行。 */
export function RunTable({
  rows,
  observations,
}: {
  rows: Awaited<ReturnType<typeof getMonitorRuns>>["runs"];
  observations: Awaited<ReturnType<typeof getMonitorRuns>>["observations"];
}) {
  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground">
        当前筛选范围没有运行记录。可以扩大时间范围，或完成一次聊天后刷新。
      </p>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>创建时间</TableHead>
          <TableHead>所属会话 / Run</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>总耗时</TableHead>
          <TableHead>已知 Token</TableHead>
          <TableHead>模型 / 工具调用</TableHead>
          <TableHead>Gateway 已知费用（USD）</TableHead>
          <TableHead>运行</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((run) => {
          const records = observations.filter((item) => item.runId === run.id);
          const summary = summarizeRuns([run], records);
          const toolCount = records.filter((item) => item.kind === "tool").length;
          return (
          <TableRow key={run.id}>
            <TableCell className="whitespace-nowrap">
              {run.createdAt.toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
              })}
            </TableCell>
            <TableCell>
              <Link
                className="text-link underline"
                href={`/admin/conversations/${run.conversationId}`}
              >
                {run.title}
              </Link>
              <span className="mt-1 block font-mono text-xs text-muted-foreground">Run {run.id.slice(0, 8)}</span>
            </TableCell>
            <TableCell>
              {(
                {
                  running: "执行中",
                  completed: "完成",
                  failed: "失败",
                  cancelled: "已取消",
                } as Record<string, string>
              )[run.status] ?? run.status}
            </TableCell>
            <TableCell>
              {durationLabel(
                run.completedAt
                  ? run.completedAt.getTime() - run.createdAt.getTime()
                  : null,
              )}
            </TableCell>
            <TableCell>{summary.totalTokens ?? "未采集"}<span className="block text-xs text-muted-foreground">用量已知 {summary.knownUsageCalls}/{summary.modelCalls} 步</span></TableCell>
            <TableCell>{records.length ? `${summary.modelCalls} / ${toolCount}` : "未采集"}</TableCell>
            <TableCell>{formatUsd(summary.costUsd)}<span className="block text-xs text-muted-foreground">费用已知 {summary.knownCostCalls}/{summary.modelCalls} 步</span></TableCell>
            <TableCell>
              <Link
                className="text-link underline"
                href={`/admin/runs/${run.id}`}
              >
                查看详情
              </Link>
            </TableCell>
          </TableRow>
        ); })}
      </TableBody>
    </Table>
  );
}
