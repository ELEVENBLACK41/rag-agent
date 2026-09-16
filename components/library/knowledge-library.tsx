/**
 * 修改时间：2026-09-16
 * 文件说明：VaultAgent 独立知识库管理工作区。
 * edit by：Sliye
 */

"use client";

import Link from "next/link";
import { ArrowLeftIcon, DatabaseIcon } from "lucide-react";
import { ImportPanel } from "@/components/chat/import-panel";
import { useImportBatch } from "@/components/chat/use-import-batch";
import { Button } from "@/components/ui/button";

/** 组合知识库上传、持久文件列表和聊天返回入口。 */
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
    <main className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <DatabaseIcon className="size-4" />
            </div>
            <div>
              <h1 className="font-semibold">知识库管理</h1>
              <p className="text-sm text-muted-foreground">上传、查看版本与管理 AI 检索范围</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/audit">结构审计</Link></Button>
          <Button asChild variant="outline">
            <Link href="/chat"><ArrowLeftIcon className="size-4" /> 返回聊天</Link>
          </Button>
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-7xl px-5 py-8">
        <ImportPanel
          batch={batch}
          error={error}
          files={library?.files ?? []}
          isLoading={isLoading}
          isUploading={isUploading}
          onRemoveFile={removeFile}
          onUpload={upload}
        />
      </section>
    </main>
  );
}
