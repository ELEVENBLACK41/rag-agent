/**
 * 修改时间：2026-09-17
 * 文件说明：持久工作区右侧的知识库管理内容。
 * edit by：Sliye
 */

"use client";

import { DatabaseIcon } from "lucide-react";
import { ImportPanel } from "@/components/chat/import-panel";
import { useImportBatch } from "@/components/chat/use-import-batch";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";

/** 组合知识库上传与持久文件列表，跨页面导航由公共侧栏负责。 */
export function KnowledgeLibrary() {
  const {
    batch,
    error,
    isLoading,
    isUploading,
    library,
    removeFile,
    upload,
  } = useImportBatch();

  return (
    <main className="min-h-full bg-background text-foreground">
      <WorkspacePageHeader
        title="知识库管理"
        description="管理已建立索引、可供 AI 查询的文档；图片请在左侧「图片附件」查看。"
        icon={DatabaseIcon}
      />
      <section aria-label="知识库文件管理" className="mx-auto max-w-6xl px-4 pb-10 sm:px-8">
        <ImportPanel
          batch={batch}
          error={error}
          files={library?.files.filter((file) => file.isQueryable) ?? []}
          isLoading={isLoading}
          isUploading={isUploading}
          onRemoveFile={removeFile}
          onUpload={upload}
        />
      </section>
    </main>
  );
}
