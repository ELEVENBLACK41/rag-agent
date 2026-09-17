/*
 * @Author: shaoliye shaoliye@fengmap.com
 * @Date: 2026-09-17 15:17:44
 * @LastEditors: shaoliye shaoliye@fengmap.com
 * @LastEditTime: 2026-09-17 15:31:02
 * @FilePath: \rag-agent\app\admin\page.tsx
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
/** 修改时间：2026-09-17 | 文件说明：管理总览的鉴权、筛选与页面组合 | edit by：Sliye */
import { isOwner } from "@/lib/auth/owner";
import {
  getMonitorRuns,
  monitorFilterSchema,
} from "@/lib/monitoring/repository";
import { summarizeRuns } from "@/lib/monitoring/statistics";
import { RunTable } from "@/components/monitoring/run-table";
import { RunSummary } from "@/components/monitoring/summary";
import { MonitorPanel } from "@/components/monitoring/monitor-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** @param searchParams 服务端入口统一校验筛选，错误不悄悄替换为默认值。 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await isOwner())) return null;
  const parsed = monitorFilterSchema.safeParse(await searchParams);
  if (!parsed.success)
    return (
      <p role="alert">
        筛选参数无效，请使用 1–720 小时、有效状态或会话 ID。
        <a href="/admin" className="text-link underline">
          重置筛选
        </a>
      </p>
    );
  const result = await getMonitorRuns(parsed.data);
  return (
    <>
      <form className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          最近小时数
          <Input
            name="hours"
            type="number"
            min={1}
            max={720}
            defaultValue={parsed.data.hours}
            className="w-32"
          />
        </label>
        <label className="space-y-1 text-sm">
          状态
          <Input
            name="status"
            list="run-statuses"
            defaultValue={parsed.data.status}
            className="w-36"
          />
          <datalist id="run-statuses">
            {["all", "running", "completed", "failed", "cancelled"].map(
              (status) => (
                <option key={status} value={status} />
              ),
            )}
          </datalist>
        </label>
        <Button type="submit">筛选 / 刷新</Button>
      </form>
      <p className="text-xs text-muted-foreground">
        最近 {parsed.data.hours} 小时；最多展示最近 100 个
        Run，以下汇总仅计算当前展示样本。
        {result.truncated ? "已有更多记录，请缩小时间范围。" : ""}
      </p>
      <MonitorPanel title="运行概况">
        <RunSummary summary={summarizeRuns(result.runs, result.observations)} />
      </MonitorPanel>
      <MonitorPanel title="运行记录（每行一个 Run）">
        <p className="mb-4 text-sm text-muted-foreground">一次提问触发一个 Run，重试会创建新的 Run；同一会话可以包含多个 Run。点击会话查看汇总，点击详情查看本次检索分数和评测成绩。</p>
        <RunTable rows={result.runs} observations={result.observations} />
      </MonitorPanel>
    </>
  );
}
