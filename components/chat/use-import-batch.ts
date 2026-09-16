/**
 * 修改时间：2026-09-17
 * 文件说明：VaultAgent 知识库清单、导入批次状态与轮询 Hook。
 *
 * Hook 只管理浏览器上传、轮询和删除后的视图状态；服务端返回的诊断与视觉
 * 资产保持原样，便于新增格式时不在客户端复制业务判断。
 *
 * edit by：Sliye
 */

import { useCallback, useEffect, useState } from "react";

export type ImportFileState = {
  id: string;
  status: string;
  errorMessage: string | null;
  displayName: string;
  sourcePath: string | null;
  mediaType: string;
  versionNumber?: number;
  byteSize?: number;
  updatedAt?: string;
  isActiveVersion?: boolean;
  /** 服务端根据版本索引状态与文档格式判定，附件不能冒充可检索文档。 */
  isQueryable?: boolean;
  diagnostics: Array<{
    severity: "warning";
    stage: "parse";
    message: string;
    pageNumber?: number;
  }>;
  visualAssets: Array<{
    pageNumber: number | null;
    sourceKey: string;
    status: string;
    errorMessage: string | null;
  }>;
};

export type KnowledgeLibraryState = {
  snapshotId: string | null;
  publishedAt: string | null;
  files: ImportFileState[];
};

export type ImportBatchState = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  errorMessage: string | null;
  files: ImportFileState[];
};

/** D4 导入批次状态轮询的最长次数。 */
const MAX_IMPORT_STATUS_CHECKS = 180;
/** D4 导入批次状态轮询间隔，单位：毫秒。 */
const IMPORT_STATUS_INTERVAL_MS = 1_000;

/** 处理多文件/ZIP 上传、批次轮询和单个逻辑文件删除。 */
export function useImportBatch() {
  const [batch, setBatch] = useState<ImportBatchState | null>(null);
  const [library, setLibrary] = useState<KnowledgeLibraryState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 从服务端重新读取当前已发布快照，避免把浏览器内存当作知识库事实来源。 */
  const refreshLibrary = useCallback(async () => {
    try {
      const result = await requestLibrary();
      setLibrary(result);
      setError(null);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;
    requestLibrary()
      .then((result) => {
        if (isCancelled) return;
        setLibrary(result);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!isCancelled) setError(toErrorMessage(loadError));
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  /** 上传一批浏览器文件，并在后台索引完成时更新展示状态。 */
  async function upload(files: File[]) {
    if (!files.length || isUploading) return;
    setError(null);
    setIsUploading(true);
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    formData.set("paths", JSON.stringify(files.map((file) => getRelativePath(file))));

    try {
      const response = await fetch("/api/imports", { method: "POST", body: formData });
      const result = (await response.json()) as { batchId?: string; error?: string };
      if (!response.ok || !result.batchId) throw new Error(result.error ?? "无法创建导入任务。");
      await waitForBatch(result.batchId);
      await refreshLibrary();
    } catch (uploadError) {
      setError(toErrorMessage(uploadError));
    } finally {
      setIsUploading(false);
    }
  }

  /** 删除一个逻辑文件，并刷新它所在批次的文件状态。 */
  async function removeFile(importId: string) {
    const response = await fetch(`/api/imports/${importId}`, { method: "DELETE" });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "无法删除文件。");
      return;
    }
    await refreshLibrary();
  }

  /** 从业务 API 获取一次批次状态，并在尚未完成时继续轮询。 */
  async function waitForBatch(batchId: string) {
    for (let attempt = 0; attempt < MAX_IMPORT_STATUS_CHECKS; attempt += 1) {
      await delay(IMPORT_STATUS_INTERVAL_MS);
      const response = await fetch(`/api/imports/${batchId}`, { cache: "no-store" });
      const result = (await response.json()) as ImportBatchState & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "无法读取导入状态。");
      setBatch(result);
      if (result.status === "completed") return;
      if (result.status === "failed") throw new Error(result.errorMessage ?? "导入失败。");
    }
    throw new Error("导入仍在执行，请稍后刷新页面查看状态。");
  }

  return {
    batch,
    error,
    isLoading,
    isUploading,
    library,
    removeFile,
    refreshLibrary,
    upload,
  };
}

/** 请求当前已发布知识库清单；状态写入由调用方决定。 */
async function requestLibrary() {
  const response = await fetch("/api/imports", { cache: "no-store" });
  const result = (await response.json()) as KnowledgeLibraryState & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "无法读取知识库文件。");
  return result;
}

/** 读取文件夹选择器保留的相对路径；普通选择或拖拽则回退到文件名。 */
function getRelativePath(file: File) {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "发生未知错误，请稍后重试。";
}
