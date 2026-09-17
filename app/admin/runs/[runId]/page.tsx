/** 修改时间：2026-09-17 | 文件说明：逐次模型、检索与来源的管理详情入口 | edit by：Sliye */
import { notFound } from "next/navigation";
import { z } from "zod";
import { isOwner } from "@/lib/auth/owner";
import { getMonitorRun } from "@/lib/monitoring/repository";
import { ConfigurationTable } from "@/components/monitoring/configuration-table";
import { RunMeasurements } from "@/components/monitoring/run-measurements";
import { RunQuality } from "@/components/monitoring/run-quality";
import {
  MonitorPanel,
  ObservationJson,
  durationLabel,
} from "@/components/monitoring/monitor-panel";

/** @param params 当前 Run ID。 */
export default async function RunMonitorPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  if (!(await isOwner())) return null;
  const parsed = z
    .string()
    .uuid()
    .safeParse((await params).runId);
  if (!parsed.success) notFound();
  const detail = await getMonitorRun(parsed.data);
  if (!detail) notFound();
  const start = detail.events.find(
    (event) => event.eventType === "execution_started",
  )?.createdAt;
  return (
    <>
      <div className="space-y-2">
        <h2 className="text-xl font-medium">{detail.title}</h2>
        <p className="break-all text-xs text-muted-foreground">
          {detail.run.id} · {detail.run.status}
        </p>
        <a
          className="text-sm text-link underline"
          href={`/api/admin/runs/${detail.run.id}`}
        >
          导出脱敏 JSON
        </a>
      </div>
      <MonitorPanel title="时延与资料范围">
        <ObservationJson
          value={{
            snapshotId: detail.run.snapshotId,
            createdAt: detail.run.createdAt,
            completedAt: detail.run.completedAt,
            eventCount: detail.eventCount,
            queue: durationLabel(
              start ? start.getTime() - detail.run.createdAt.getTime() : null,
            ),
            firstProgress: durationLabel(
              detail.firstProgressAt
                ? detail.firstProgressAt.getTime() -
                    detail.run.createdAt.getTime()
                : null,
            ),
            firstFormalAnswer: durationLabel(
              detail.firstAnswerAt
                ? detail.firstAnswerAt.getTime() -
                    detail.run.createdAt.getTime()
                : null,
            ),
          }}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          首正式答案排除后来被工具阶段替换的临时正文；直接回答仅在成功完成后确认。模型响应时间与包含工具执行的步骤耗时分别记录。
        </p>
      </MonitorPanel>
      <RunMeasurements detail={detail} />
      <RunQuality runId={detail.run.id} />
      <MonitorPanel title="当次配置与原始观测">
        {detail.observations.length ? (
          detail.observations.map((item) => (
            <details className="border-b py-3" key={item.observationId}>
              <summary className="cursor-pointer text-sm">
                {item.kind} · {item.observationId}
              </summary>
              {item.kind === "configuration" ? <ConfigurationTable value={item.payload} /> : <ObservationJson value={item.payload} />}
            </details>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            该 Run 尚无管理观测记录；旧历史不会用当前配置回填。
          </p>
        )}
      </MonitorPanel>
      <MonitorPanel title="原始事件记录（排查用）">
        {detail.events.map((event) => (
          <details className="border-b py-3" key={event.id}>
            <summary className="cursor-pointer text-sm">
              #{event.sequence} · {event.eventType} ·{" "}
              {event.createdAt.toISOString()}
            </summary>
            <ObservationJson value={event.payload} />
          </details>
        ))}
      </MonitorPanel>
    </>
  );
}
