/** 修改时间：2026-09-16 | 文件说明：审计来源的只读原文片段抽屉和下载入口 | edit by：Sliye */
"use client";
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { AuditSource } from "@/lib/audit/types";

type SourcePreview = { path: string; version: number; line: number; startLine: number; content: string | null; note: string };
export type AuditSelection = { snapshotId: string; source: AuditSource };

/** 关闭抽屉或切换来源时中止旧读取；React 纯文本渲染不执行原文 HTML。
 * @param selection 用户点击的快照与来源版本。
 * @param onClose 关闭回调。
 */
export function AuditSourceDrawer({ selection, onClose }: { selection: AuditSelection | null; onClose: () => void }) {
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const url = selection ? `/api/audit/source?${new URLSearchParams({ snapshot: selection.snapshotId, file: selection.source.fileVersionId, line: String(selection.source.line) })}` : null;
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "读取原文失败。");
        if (!controller.signal.aborted) setPreview(data);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取原文失败。"); }
    })();
    return () => controller.abort();
  }, [url, retry]);
  return <Sheet open={Boolean(selection)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
      <SheetHeader>
        <SheetTitle className="break-all">{selection?.source.path ?? "审计来源"}</SheetTitle>
        <SheetDescription>版本 {selection?.source.version} · 第 {selection?.source.line} 行 · 当前快照只读原文</SheetDescription>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-6">
        {error ? <div role="alert" className="space-y-3 text-sm text-destructive"><p>{error}</p><Button variant="outline" onClick={() => { setError(null); setPreview(null); setRetry((value) => value + 1); }}>重试读取</Button></div>
          : !preview ? <p role="status">正在读取原文…</p> : <>
            <p className="text-sm text-muted-foreground">{preview.note}</p>
            {preview.content !== null && <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-sm">{preview.content.split("\n").map((line, index) => <div key={index} className={preview.startLine + index === preview.line ? "bg-accent text-accent-foreground" : undefined}><span className="mr-4 select-none text-muted-foreground">{preview.startLine + index}</span>{line || " "}</div>)}</pre>}
            <Button asChild variant="outline"><a href={`${url}&download=1`}>下载原文件核对</a></Button>
          </>}
      </div>
    </SheetContent>
  </Sheet>;
}
