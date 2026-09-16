/**
 * 修改时间：2026-09-16
 * 文件说明：展示最终回答明确选择且经服务端授权的知识库原图。
 *
 * 图片地址只由 Run 与 Chunk 标识组成，浏览器不能接触存储键；加载失败保留
 * 来源入口，不把无法读取的图片伪装成成功结果。
 *
 * edit by：Sliye
 */

"use client";

import Image from "next/image";
import { useState } from "react";
import { ImageOffIcon, ZoomInIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { AnswerCitation } from "@/lib/chat/types";

type MessageImageGalleryProps = {
  citations: AnswerCitation[];
  runId: string;
};

/** 只渲染模型选择并由服务端标记的图片，普通视觉证据仍保留来源卡片。 */
export function MessageImageGallery({
  citations,
  runId,
}: MessageImageGalleryProps) {
  const images = citations.filter((citation) => citation.displayImage);
  if (!images.length) return null;
  return (
    <section
      aria-label="回答中找到的图片"
      className="grid gap-3 sm:grid-cols-2"
    >
      {images.map((citation) => (
        <KnowledgeImageCard
          citation={citation}
          key={citation.chunkId}
          runId={runId}
        />
      ))}
    </section>
  );
}

/** 单张图片独立维护加载状态，避免一张失败影响同组其他来源。 */
function KnowledgeImageCard({
  citation,
  runId,
}: {
  citation: AnswerCitation;
  runId: string;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  const [previewStatus, setPreviewStatus] = useState<
    "loading" | "loaded" | "failed"
  >("loading");
  const imageUrl = `/api/runs/${encodeURIComponent(runId)}/sources/${encodeURIComponent(citation.chunkId)}/asset`;
  return (
    <figure className="overflow-hidden rounded-xl border border-border/60 bg-muted/20">
      <Dialog>
        <DialogTrigger
          aria-label={`查看大图：${citation.displayName}`}
          className="group relative block aspect-video w-full cursor-zoom-in bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed"
          disabled={status === "failed"}
        >
          {status !== "failed" ? (
            <>
              <Image
                alt={`${citation.displayName} 中找到的图片`}
                className="object-contain transition-transform group-hover:scale-[1.01]"
                fill
                onError={() => setStatus("failed")}
                onLoad={() => setStatus("loaded")}
                sizes="(max-width: 640px) 100vw, 360px"
                src={imageUrl}
                unoptimized
              />
              <span className="absolute end-2 top-2 rounded-md bg-background/80 p-1.5 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <ZoomInIcon className="size-4" />
              </span>
            </>
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
              <ImageOffIcon className="size-5" />
              图片当前不可用
            </div>
          )}
          {status === "loading" && (
            <span
              aria-label="图片加载中"
              className="absolute inset-0 animate-pulse bg-muted"
              role="status"
            />
          )}
        </DialogTrigger>
        <DialogContent className="grid h-[min(90dvh,60rem)] max-w-[calc(100%-1rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background p-3 sm:max-w-[min(92vw,80rem)]">
          <DialogHeader className="pe-10">
            <DialogTitle className="truncate">{citation.displayName}</DialogTitle>
            <DialogDescription>大图预览，按 Esc 或右上角关闭。</DialogDescription>
          </DialogHeader>
          <div className="relative min-h-0 overflow-hidden rounded-lg bg-muted/30">
            {previewStatus !== "failed" ? (
              <Image
                alt={`${citation.displayName} 大图预览`}
                className="object-contain"
                fill
                onError={() => setPreviewStatus("failed")}
                onLoad={() => setPreviewStatus("loaded")}
                sizes="92vw"
                src={imageUrl}
                unoptimized
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <ImageOffIcon className="size-6" />
                大图当前不可用
              </div>
            )}
            {previewStatus === "loading" && (
              <div
                aria-label="大图加载中"
                className="absolute inset-0 animate-pulse bg-muted"
                role="status"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
      <figcaption className="truncate px-3 py-2 text-xs text-muted-foreground">
        {citation.displayName}
      </figcaption>
    </figure>
  );
}
