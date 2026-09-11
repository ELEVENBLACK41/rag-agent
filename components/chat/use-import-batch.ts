/**
 * 修改时间：2026-09-11 | 文件说明：VaultAgent 导入批次状态与轮询 Hook | edit by：Sliye
 */

import { useState } from "react";

export type ImportFileState = {
  id: string;
  status: string;
  errorMessage: string | null;
  displayName: string;
  sourcePath: string | null;
  mediaType: string;
  diagnostics: Array<{
    severity: "warning";
    stage: "parse";
    message: string;
    pageNumber?: number;
  }>;
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
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setBatch((current) => current && {
      ...current,
      files: current.files.map((file) => (file.id === importId ? { ...file, status: "deleted" } : file)),
    });
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
    canChat: batch?.status === "completed",
    error,
    isUploading,
    removeFile,
    upload,
  };
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
