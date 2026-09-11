/**
 * 修改时间：2026-09-11 | 文件说明：VaultAgent 多文件与 ZIP 导入面板 | edit by：Sliye
 */

import { useRef, useState } from "react";
import { FileArchiveIcon, FileTextIcon, FolderUpIcon, ImageIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ImportBatchState } from "@/components/chat/use-import-batch";

type ImportPanelProps = {
  batch: ImportBatchState | null;
  error: string | null;
  isUploading: boolean;
  onRemoveFile: (importId: string) => void;
  onUpload: (files: File[]) => void;
};

/** 展示导入入口、批次状态和可删除的已保存文件。 */
export function ImportPanel({ batch, error, isUploading, onRemoveFile, onUpload }: ImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const files = batch?.files ?? [];

  /** 统一处理系统文件选择和拖拽文件，避免两条上传逻辑漂移。 */
  function submitFiles(selectedFiles: FileList | File[]) {
    const nextFiles = Array.from(selectedFiles);
    if (nextFiles.length) onUpload(nextFiles);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><FolderUpIcon className="size-4" /> 导入知识库</CardTitle>
        <CardDescription>支持多选、拖拽或 ZIP。MD/TXT/PDF 会建立索引；图片、Word、Excel 先作为附件保留。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className={`rounded-md border border-dashed p-4 text-center transition-colors ${isDragging ? "border-primary bg-accent" : "border-border"}`}
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            submitFiles(event.dataTransfer.files);
          }}
        >
          <FileArchiveIcon className="mx-auto mb-2 size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">拖入文件或 ZIP，最多 50 个文件、25 MB 上传。</p>
          <Button className="mt-3" disabled={isUploading} onClick={() => inputRef.current?.click()} size="sm" type="button" variant="outline">
            选择文件
          </Button>
          <Input
            accept=".md,.txt,.zip,.png,.jpg,.jpeg,.pdf,.docx,.xlsx"
            className="hidden"
            disabled={isUploading}
            multiple
            onChange={(event) => submitFiles(event.currentTarget.files ?? [])}
            ref={inputRef}
            type="file"
          />
        </div>
        {isUploading && <Badge variant="secondary">正在保存并建立候选索引…</Badge>}
        {batch && <BatchStatus status={batch.status} />}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {files.length > 0 && <ul className="space-y-2" aria-label="导入文件列表">
          {files.map((file) => (
            <li className="space-y-1 text-sm" key={file.id}>
              <div className="flex items-center gap-2">
                {file.mediaType.startsWith("image/") ? <ImageIcon className="size-4 text-muted-foreground" /> : <FileTextIcon className="size-4 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate">{file.sourcePath ?? file.displayName}</span>
                <Badge variant={file.status === "failed" ? "destructive" : "secondary"}>{getFileStatusLabel(file.status, file.mediaType)}</Badge>
                {file.status !== "deleted" && <Button aria-label={`删除 ${file.displayName}`} onClick={() => onRemoveFile(file.id)} size="icon-sm" type="button" variant="ghost"><Trash2Icon className="size-4" /></Button>}
              </div>
              {file.diagnostics.map((diagnostic) => (
                <p className="pl-6 text-xs text-muted-foreground" key={`${diagnostic.stage}-${diagnostic.pageNumber ?? 0}-${diagnostic.message}`}>
                  {diagnostic.pageNumber ? `第 ${diagnostic.pageNumber} 页：` : ""}{diagnostic.message}
                </p>
              ))}
            </li>
          ))}
        </ul>}
      </CardContent>
    </Card>
  );
}

function BatchStatus({ status }: { status: ImportBatchState["status"] }) {
  const labels: Record<ImportBatchState["status"], string> = {
    queued: "正在排队",
    running: "正在解析与生成向量",
    completed: "本批文件已发布，可参与检索",
    failed: "本批导入失败，旧资料仍可使用",
  };
  return <Badge variant={status === "failed" ? "destructive" : "secondary"}>{labels[status]}</Badge>;
}

function getFileStatusLabel(status: string, mediaType: string) {
  if (status === "completed" && mediaType === "application/pdf") return "已发布";
  if (status === "completed" && !mediaType.startsWith("text/")) return "附件已保存";
  const labels: Record<string, string> = { completed: "已发布", ready: "附件已保存", running: "处理中", queued: "排队中", failed: "失败", deleted: "已删除" };
  return labels[status] ?? status;
}
