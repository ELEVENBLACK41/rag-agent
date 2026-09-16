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
import { ImageOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnswerCitation } from "@/lib/chat/types";

type MessageImageGalleryProps = {
  citations: AnswerCitation[];
  runId: string;
  onCitation: (citation: AnswerCitation) => void;
};

/** 只渲染模型选择并由服务端标记的图片，普通视觉证据仍保留来源卡片。 */
export function MessageImageGallery({
  citations,
  runId,
  onCitation,
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
          onOpen={() => onCitation(citation)}
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
  onOpen,
}: {
  citation: AnswerCitation;
  runId: string;
  onOpen: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  const imageUrl = `/api/runs/${encodeURIComponent(runId)}/sources/${encodeURIComponent(citation.chunkId)}/asset`;
  return (
    <figure className="overflow-hidden rounded-xl border border-border/60 bg-muted/20">
      <div className="relative aspect-video bg-muted/40">
        {status !== "failed" ? (
          <Image
            alt={`${citation.displayName} 中找到的图片`}
            className="object-contain"
            fill
            onError={() => setStatus("failed")}
            onLoad={() => setStatus("loaded")}
            sizes="(max-width: 640px) 100vw, 360px"
            src={imageUrl}
            unoptimized
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
            <ImageOffIcon className="size-5" />
            图片当前不可用
          </div>
        )}
        {status === "loading" && (
          <div
            aria-label="图片加载中"
            className="absolute inset-0 animate-pulse bg-muted"
            role="status"
          />
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {citation.displayName}
        </span>
        <Button onClick={onOpen} size="sm" type="button" variant="ghost">
          查看来源
        </Button>
      </figcaption>
    </figure>
  );
}
