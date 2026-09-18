/** 修改时间：2026-09-17 | 文件说明：纯图片附件卡片，懒加载、悬停信息与失败重试 | edit by：Sliye */
"use client";
import { useEffect, useRef, useState } from "react";
import { ImageOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImageAttachment } from "@/components/library/use-image-gallery";

/**
 * 附件走鉴权接口，不交给公共图片优化缓存；保持原始宽高比以形成瀑布流。
 * @param image 服务端返回的当前快照图片。
 * @param onOpen 打开可键盘关闭的原图预览。
 */
export function ImageAttachmentCard({ image, onOpen }: { image: ImageAttachment; onOpen: (trigger: HTMLButtonElement) => void }) {
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /** 单张卡片观察目标，进入可视区域后才赋予图片 src。 */
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    // https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  return (
    <figure ref={cardRef} className="group relative mb-4 break-inside-avoid overflow-hidden rounded-2xl border border-border/70 bg-card">
      {failed ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 bg-muted/40 p-4 text-center">
          <ImageOffIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          <p role="status" className="text-xs text-muted-foreground">图片读取失败，资料可能已更新</p>
          <Button size="sm" variant="outline" onClick={() => { setFailed(false); setLoaded(false); setAttempt((value) => value + 1); }}>重试图片</Button>
        </div>
      ) : (
        <button type="button" onClick={(event) => onOpen(event.currentTarget)} aria-label={`查看图片 ${image.name}`} className="relative block w-full cursor-zoom-in overflow-hidden bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
          {!loaded && <div aria-hidden="true" className="h-60 animate-pulse bg-muted motion-reduce:animate-none" />}
          {visible && (
            // https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img#loading
            // 原图来自同源私有接口，禁用 Next Image 优化并由浏览器异步解码。
            // eslint-disable-next-line @next/next/no-img-element
            <img key={attempt} src={`${image.url}&attempt=${attempt}`} alt={image.name} loading="lazy" decoding="async"
              className={loaded ? "block h-auto w-full" : "absolute inset-0 w-full opacity-0"}
              onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
          )}
        </button>
      )}
      {loaded && !failed && (
        // 信息层不占布局高度，也不截获图片点击；键盘聚焦与鼠标悬停同样可读。
        <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-transparent px-3 py-3 text-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
          <p className="truncate text-xs font-medium">{image.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">v{image.version} · {(image.byteSize / 1024).toFixed(1)} KB · 图片附件</p>
        </figcaption>
      )}
    </figure>
  );
}
