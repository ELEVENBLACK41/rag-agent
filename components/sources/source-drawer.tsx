/**
 * 修改时间：2026-09-14
 * 文件说明：VaultAgent D9 右侧来源抽屉。
 *
 * 抽屉只按已保存的 Run 与引用 Chunk 请求服务端来源接口。解析文本、PDF 原文件和
 * 视觉派生图片分别标注，避免把 Office/PDF 解析结果误导为完整格式还原。
 *
 * edit by：Sliye
 */

"use client";

import { useEffect, useState } from "react";
import { FileTextIcon, ImageIcon, LoaderCircleIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SourceCitation, SourcePreview } from "@/lib/sources/types";

type SourceDrawerProps = {
  citation: SourceCitation | null;
  runId: string | null;
  onOpenChange: (open: boolean) => void;
};

type SourceLoadState = {
  key: string;
  preview?: SourcePreview;
  error?: string;
};

/** 按当前 Run 的真实引用读取来源，关闭时不保留上一份私有正文。 */
export function SourceDrawer({ citation, runId, onOpenChange }: SourceDrawerProps) {
  const [loadState, setLoadState] = useState<SourceLoadState | null>(null);
  const sourceKey = citation && runId ? `${runId}:${citation.chunkId}` : null;
  const preview = loadState?.key === sourceKey ? loadState.preview ?? null : null;
  const error = loadState?.key === sourceKey ? loadState.error ?? null : null;

  useEffect(() => {
    if (!citation || !runId || !sourceKey) return;

    const controller = new AbortController();
    void loadPreview(runId, citation.chunkId, controller.signal)
      .then((loadedPreview) => setLoadState({ key: sourceKey, preview: loadedPreview }))
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setLoadState({
          key: sourceKey,
          error: loadError instanceof Error ? loadError.message : "无法读取来源。",
        });
      });
    return () => controller.abort();
  }, [citation, runId, sourceKey]);

  /** 关闭抽屉时立即移除已读取的私有正文。 */
  function handleOpenChange(open: boolean) {
    if (!open) setLoadState(null);
    onOpenChange(open);
  }

  return (
    <Sheet open={Boolean(citation && runId)} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full p-0 sm:max-w-xl" side="right">
        <SheetHeader className="border-b px-5 py-4 pr-12">
          <SheetTitle>{citation?.displayName ?? "来源"}</SheetTitle>
          <SheetDescription>{citation ? describeCitationLocation(citation) : ""}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100dvh-85px)]">
          <div className="space-y-4 px-5 py-4">
            {!preview && !error && <LoadingSource />}
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            {preview && <SourcePreviewContent preview={preview} />}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

/** 从受鉴权来源 API 加载抽屉内容。 */
async function loadPreview(runId: string, chunkId: string, signal: AbortSignal) {
  const response = await fetch(
    `/api/runs/${encodeURIComponent(runId)}/sources/${encodeURIComponent(chunkId)}`,
    { cache: "no-store", signal },
  );
  const payload = (await response.json()) as SourcePreview & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "无法读取来源。");
  return payload;
}

/** 根据来源类型展示文本预览、原始 PDF 或受限视觉派生图片。 */
function SourcePreviewContent({ preview }: { preview: SourcePreview }) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">解析片段</Badge>
        <Badge variant="outline">{preview.mediaType}</Badge>
      </div>
      {preview.visualAssetUrl && (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium"><ImageIcon className="size-4" />视觉派生图片</p>
          {/* 私有来源需携带当前会话 Cookie，不能让 Next 图片优化器以服务端无授权请求代取。 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={`${preview.displayName} 的视觉来源`} className="max-h-96 w-full rounded-lg border object-contain" src={preview.visualAssetUrl} />
        </div>
      )}
      {preview.documentUrl && (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium"><FileTextIcon className="size-4" />原始 PDF</p>
          <iframe className="h-96 w-full rounded-lg border bg-muted" src={buildPdfLocation(preview.documentUrl, preview.sourceLocator)} title={`${preview.displayName} PDF 预览`} />
        </div>
      )}
      <div className="space-y-2">
        <p className="text-sm font-medium">{preview.documentUrl ? "当前定位的解析片段" : "可定位的解析片段"}</p>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-6 text-foreground">{preview.content}</pre>
      </div>
    </>
  );
}

/** PDF 在浏览器预览中跳转到解析器记录的物理页。 */
function buildPdfLocation(url: string, locator: SourcePreview["sourceLocator"]) {
  return locator?.format === "pdf" || locator?.format === "pdf-visual"
    ? `${url}#page=${locator.pageNumber}`
    : url;
}

/** 来源抽屉加载状态。 */
function LoadingSource() {
  return <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircleIcon className="size-4 animate-spin" />正在读取已授权来源…</p>;
}

/** 将引用定位转换为人可读标题。 */
function describeCitationLocation(citation: SourceCitation) {
  if (citation.sourceLocator?.format === "pdf") return `第 ${citation.sourceLocator.pageNumber} 页`;
  if (citation.sourceLocator?.format === "pdf-visual") return `第 ${citation.sourceLocator.pageNumber} 页 · 视觉分析`;
  if (citation.sourceLocator?.format === "docx") return citation.sourceLocator.blockType === "table" ? `表格 ${citation.sourceLocator.tableIndex ?? citation.sourceLocator.blockIndex}` : `段落 ${citation.sourceLocator.blockIndex}`;
  if (citation.sourceLocator?.format === "docx-visual") return `内嵌图片 ${citation.sourceLocator.imageIndex}`;
  if (citation.sourceLocator?.format === "xlsx") return `${citation.sourceLocator.sheetName} · ${citation.sourceLocator.range}`;
  if (citation.sourceLocator?.format === "xlsx-visual") return `${citation.sourceLocator.sheetName} · ${citation.sourceLocator.anchor} · 图片 ${citation.sourceLocator.imageIndex}`;
  if (citation.startLine !== null && citation.endLine !== null) return `第 ${citation.startLine}-${citation.endLine} 行`;
  return "位置不可用";
}
