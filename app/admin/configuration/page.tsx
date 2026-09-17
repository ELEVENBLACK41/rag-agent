/** 修改时间：2026-09-17 | 文件说明：实际配置、资源与完整指标目录的管理入口 | edit by：Sliye */
import { isOwner } from "@/lib/auth/owner";
import { getEffectiveConfiguration } from "@/lib/monitoring/configuration";
import { getResourceSummary } from "@/lib/monitoring/repository";
import { metricCatalog } from "@/lib/monitoring/metric-catalog";
import { ConfigurationTable } from "@/components/monitoring/configuration-table";
import {
  MonitorPanel,
  ObservationJson,
} from "@/components/monitoring/monitor-panel";

/** 服务端检查身份后才查询资源和生效配置。 */
export default async function ConfigurationPage() {
  if (!(await isOwner())) return null;
  const resources = await getResourceSummary();
  return (
    <>
      <MonitorPanel title="当前实际配置">
        <p className="mb-4 text-sm text-muted-foreground">以下是当前服务实际使用的参数。它们是运行限制，不是某一次回答的实测成绩。</p>
        <ConfigurationTable value={getEffectiveConfiguration()} />
      </MonitorPanel>
      <MonitorPanel title="指标说明与采集范围">
        <p className="mb-4 text-sm text-muted-foreground">这里是数据字典：解释每类指标从哪里来、怎么算、缺失时代表什么。实际数值请在运行总览或 Run 详情查看。</p>
        {metricCatalog.map((metric) => (
          <details className="border-b py-3" key={metric.group}>
            <summary className="cursor-pointer text-sm font-medium">
              {metric.group}
            </summary>
            <dl className="mt-3 space-y-2 text-sm leading-6">
              <dt className="text-muted-foreground">来源 / 单位</dt>
              <dd>
                {metric.source} / {metric.unit}
              </dd>
              <dt className="text-muted-foreground">统计口径</dt>
              <dd>{metric.meaning}</dd>
              <dt className="text-muted-foreground">覆盖限制</dt>
              <dd>{metric.missing}</dd>
            </dl>
          </details>
        ))}
      </MonitorPanel>
      <MonitorPanel title="导入与资源">
        <ObservationJson value={resources} />
      </MonitorPanel>
    </>
  );
}
