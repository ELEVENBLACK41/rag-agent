/** 修改时间：2026-09-17 | 文件说明：图片附件分页、取消请求和滚动加载状态 | edit by：Sliye */
"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** 图片条目仅包含展示信息及受保护 URL。 */
export type ImageAttachment = {
  id: string;
  importId: string;
  name: string;
  version: number;
  byteSize: number;
  url: string;
};

/** 每页固定快照，避免上传发布期间混合新旧版本。 */
type ImagePage = {
  items: ImageAttachment[];
  total: number;
  snapshotId: string | null;
  nextOffset: number | null;
};

/** 获取分页数据，卸载时取消；失败停止自动加载，保留手动重试。 */
export function useImageGallery() {
  const [page, setPage] = useState<ImagePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  /** 当前网络请求同时充当同步互斥锁，避免观察器连续触发重复分页。 */
  const requestRef = useRef<AbortController | null>(null);
  /** 瀑布流后的分页哨兵。 */
  const sentinelRef = useRef<HTMLDivElement>(null);

  /**
   * @param offset 首次或刷新为 0，其余取服务端返回值。
   * @param snapshotId 后续页使用首屏返回的快照。
   */
  const loadPage = useCallback((offset = 0, snapshotId?: string | null) => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const query = new URLSearchParams({ offset: String(offset) });
    if (snapshotId) query.set("snapshotId", snapshotId);
    return fetch(`/api/attachments?${query}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) {
        setStale(response.status === 409);
        const failure = await response.json() as { error: string };
        throw new Error(failure.error);
      }
      return await response.json() as ImagePage;
    }).then((next) => {
      if (controller.signal.aborted) return;
      setError(null);
      setStale(false);
      setPage((previous) => ({ ...next, items: offset === 0 ? next.items : [...(previous?.items ?? []), ...next.items] }));
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "图片加载失败，请重试。");
    }).finally(() => {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    void loadPage();
    return () => { requestRef.current?.abort(); requestRef.current = null; };
  }, [loadPage]);

  /** 只读取服务端提供的下一页偏移，末页不再发请求。 */
  const loadMore = useCallback(() => {
    if (requestRef.current || !page || page.nextOffset === null) return;
    setLoading(true);
    setError(null);
    void loadPage(page.nextOffset, page.snapshotId);
  }, [loadPage, page]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || loading || error || page?.nextOffset == null) return;
    // https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API
    // 仅在列表尾部接近可视区域时取下一页；默认根也遵守工作区滚动容器的裁剪。
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) loadMore();
    }, { rootMargin: "240px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, error, page?.nextOffset, loadMore]);

  /** 用户主动刷新时保留旧图片到新请求成功，避免闪空。 */
  function refresh() {
    if (requestRef.current) return;
    setLoading(true);
    setError(null);
    return loadPage();
  }

  return { page, loading, error, stale, sentinelRef, loadMore, refresh };
}
