/** 修改时间：2026-09-17 | 文件说明：管理端复用的信息分区、缺失值和详情展示 | edit by：Sliye */
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** @param title 分区名称。 @param children 真实指标或详情。 */
export function MonitorPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** @param value 可为空的结构化观测，空值明确显示未采集。 */
export function ObservationJson({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-4 text-xs leading-6">
      {value == null ? "未采集" : JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** @param value 毫秒；无数据时不展示 0 秒。 */
export function durationLabel(value: number | null) {
  return value == null ? "未采集" : `${(value / 1000).toFixed(2)} 秒`;
}
