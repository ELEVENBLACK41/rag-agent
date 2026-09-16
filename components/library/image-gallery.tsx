/** 修改时间：2026-09-17 | 文件说明：图片附件瀑布流页面与原图预览，复用工作区主题 | edit by：Sliye */
"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { ImagesIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";
import { ImageAttachmentCard } from "@/components/library/image-attachment-card";
import { useImageGallery, type ImageAttachment } from "@/components/library/use-image-gallery";

/** 加载时仅用于占位的高低节奏，不表示真实图片大小或虚构数据。 */
const PLACEHOLDER_HEIGHTS = ["h-48", "h-72", "h-56", "h-80", "h-64", "h-44", "h-72", "h-52"];
/** 响应式 CSS 多列保持每张图片完整，不依赖额外布局库。 */
const GALLERY_COLUMNS = "columns-1 gap-4 min-[420px]:columns-2 md:columns-3 lg:columns-2 xl:columns-4 2xl:columns-5";

/** 组合图库、异步分页状态和可访问的原图预览。 */
export function ImageGallery() {
  const { sentinelRef, ...gallery } = useImageGallery();
  const [selected, setSelected] = useState<ImageAttachment | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  /** 共用一个 Dialog 时记录原卡片，关闭后恢复键盘焦点。 */
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <main className="min-h-full bg-background text-foreground">
      <WorkspacePageHeader title="图片附件" description="集中浏览知识库中保存的图片，点击查看原图。图片随滚动按需加载。" icon={ImagesIcon} />
      <section aria-label="图片附件图库" className="mx-auto max-w-6xl px-4 pb-10 sm:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{gallery.page ? `${gallery.page.total} 张图片 · 已显示 ${gallery.page.items.length} 张` : "正在读取图片附件…"}</p>
          <Button variant="outline" className="rounded-lg" disabled={gallery.loading} onClick={() => { setSelected(null); void gallery.refresh(); }}><RefreshCwIcon className="size-4" />刷新图片</Button>
        </div>
        {gallery.error && <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <span className="flex-1">{gallery.error}</span><Button variant="outline" size="sm" disabled={gallery.loading} onClick={() => { setSelected(null); void gallery.refresh(); }}>{gallery.stale ? "刷新列表" : "重新加载"}</Button>
        </div>}
        {gallery.page && gallery.page.total === 0 && !gallery.loading && <div className="rounded-2xl border border-dashed bg-muted/30 px-5 py-16 text-center">
          <ImagesIcon className="mx-auto mb-4 size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="font-medium">还没有图片附件</h2>
          <p className="mt-2 text-sm text-muted-foreground">在知识库上传图片或包含图片的 ZIP，发布后会展示在这里。</p>
          <Button asChild variant="outline" className="mt-5"><Link href="/library">前往知识库上传</Link></Button>
        </div>}
        <div className={GALLERY_COLUMNS}>
          {gallery.page?.items.map((image) => <ImageAttachmentCard key={`${gallery.page?.snapshotId}:${image.id}`} image={image} onOpen={(trigger) => { previewTriggerRef.current = trigger; setPreviewFailed(false); setSelected(image); }} />)}
        </div>
        {gallery.loading && <div role="status" aria-label="正在加载图片" className={GALLERY_COLUMNS}>
          <span className="sr-only">正在加载图片…</span>
          {PLACEHOLDER_HEIGHTS.map((height, index) => <div key={index} aria-hidden="true" className={`mb-4 break-inside-avoid rounded-2xl bg-muted/60 motion-safe:animate-pulse ${height}`} />)}
        </div>}
        <div ref={sentinelRef} className="flex min-h-16 items-center justify-center pt-4">
          {!gallery.loading && !gallery.error && gallery.page?.nextOffset != null && <Button variant="ghost" onClick={gallery.loadMore}>加载更多图片</Button>}
          {!gallery.loading && !gallery.error && !!gallery.page?.items.length && gallery.page.nextOffset === null && <p className="text-xs text-muted-foreground">已显示全部图片</p>}
        </div>
      </section>
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-5xl" onCloseAutoFocus={(event) => { event.preventDefault(); previewTriggerRef.current?.focus(); }}>
          <DialogHeader className="pr-8"><DialogTitle className="break-all leading-relaxed">{selected?.name}</DialogTitle><DialogDescription>图片附件 · v{selected?.version}{selected && ` · ${(selected.byteSize / 1024).toFixed(1)} KB`}</DialogDescription></DialogHeader>
          {selected && (previewFailed ? <p role="alert" className="py-12 text-center text-sm text-destructive">原图读取失败，请关闭预览后刷新图片列表。</p> : (
            // 私有图片使用同源受保护接口，不经过公共图片优化服务。
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selected.url} alt={selected.name} className="mx-auto h-auto max-h-[70dvh] max-w-full rounded-lg object-contain" onError={() => setPreviewFailed(true)} />
          ))}
        </DialogContent>
      </Dialog>
    </main>
  );
}
