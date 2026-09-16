/** 修改时间：2026-09-16 | 文件说明：审计报告请求、重跑、取消等待与来源读取状态 | edit by：Sliye */
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditReport } from "@/lib/audit/types";

type AuditResponse = { snapshotId: string | null; report: AuditReport | null };

/** 独立管理异步状态；重新检查时清空旧结果，避免失败后把旧报告当作本次结果。 */
export function useStructureAudit() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const load = useCallback((rerun = false) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    return fetch("/api/audit", {
      method: rerun ? "POST" : "GET",
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "审计请求失败。");
        return result as AuditResponse;
      })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "无法读取审计报告。",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, []);
  const refresh = useCallback(
    (rerun = false) => {
      setLoading(true);
      setError(null);
      setData(null);
      return load(rerun);
    },
    [load],
  );
  useEffect(() => {
    void load();
    return () => activeRequest.current?.abort();
  }, [load]);
  const cancel = () => {
    activeRequest.current?.abort();
    setLoading(false);
    setError(
      "已取消等待。已经开始的服务端规则检查可能仍会完成；可刷新查看结果。",
    );
  };
  return { data, loading, error, refresh, cancel };
}
