/**
 * 修改时间：2026-09-17
 * 文件说明：VaultAgent 多文件上传与当前知识库文件清单。
 *
 * 面板展示批次真实状态、格式解析警告和视觉资产进度；它不根据文件扩展名
 * 推测能力，所有可见状态均来自服务端已持久化的导入记录。
 *
 * edit by：Sliye
 */

import { useRef, useState } from "react";
import { FileArchiveIcon, FileTextIcon, FolderUpIcon, ImageIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ImportBatchState, ImportFileState } from "@/components/chat/use-import-batch";

type ImportPanelProps = {
  batch: ImportBatchState | null;
  error: string | null;
  files: ImportFileState[];
  importProgress: number | null;
  isLoading: boolean;
  isUploading: boolean;
  onRemoveFile: (importId: string) => void;
  onUpload: (files: File[]) => void;
};

/** 展示导入入口、批次状态和可删除的已保存文件。 */
export function ImportPanel({ batch, error, files, importProgress, isLoading, isUploading, onRemoveFile, onUpload }: ImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  /** 统一处理系统文件选择和拖拽文件，避免两条上传逻辑漂移。 */
  function submitFiles(selectedFiles: FileList | File[]) {
    const nextFiles = Array.from(selectedFiles);
    if (nextFiles.length) onUpload(nextFiles);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <Card className="min-w-0 rounded-2xl ring-border [--card-spacing:--spacing(5)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><FolderUpIcon className="size-4" /> 导入知识库</CardTitle>
          <CardDescription className="leading-relaxed">支持多选、拖拽或 ZIP。MD、TXT、PDF、DOCX 和 XLSX 会建立索引；图片作为附件保留。视觉分析单文件最多 20 张，整批最多 50 张。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            className={`rounded-xl border border-dashed px-4 py-8 text-center transition-colors ${isDragging ? "border-primary bg-accent" : "border-border bg-muted/30 hover:bg-muted/60"}`}
            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              submitFiles(event.dataTransfer.files);
            }}
          >
            <FileArchiveIcon aria-hidden="true" className="mx-auto mb-4 size-7 text-muted-foreground" />
            <p className="text-sm font-medium">拖入文件或 ZIP</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">最多 50 个文件 · 总计 25 MB</p>
            <Button className="mt-5 rounded-lg" disabled={isUploading} onClick={() => inputRef.current?.click()} size="sm" type="button">
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
          {isUploading && importProgress !== null && (
            <div className="space-y-2" role="status" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  {getImportProgressLabel(batch?.progressStage, importProgress)}
                </span>
                <span className="tabular-nums">{importProgress}%</span>
              </div>
              <Progress aria-label="整体导入进度" value={importProgress} />
            </div>
          )}
          {batch && <BatchStatus status={batch.status} />}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </CardContent>
      </Card>
      <Card className="min-w-0 rounded-2xl ring-border [--card-spacing:--spacing(5)]">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">可查询文档<Badge variant="secondary" className="rounded-md tabular-nums">{isLoading ? "读取中" : `${files.length} 个文档`}</Badge></CardTitle>
          <CardDescription className="leading-relaxed">仅展示当前已发布且建立索引的文档。同一路径再次导入会替换后续 AI 检索所用版本；图片集中展示在「图片附件」。</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <p role="status" className="rounded-xl bg-muted/40 p-5 text-sm text-muted-foreground">正在读取知识库文件…</p>}
          {!isLoading && files.length === 0 && <div className="rounded-xl bg-muted/30 px-5 py-12 text-center"><FileTextIcon className="mx-auto mb-4 size-7 text-muted-foreground" /><p className="font-medium">还没有可查询文档</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">上传文档并完成索引后会出现在这里；已保存的图片请前往「图片附件」。</p></div>}
          {files.length > 0 && (
            <ScrollArea className="h-[60dvh] min-h-72 max-h-[42rem] pr-3">
              <ul className="divide-y divide-border" aria-label="知识库文件列表">
                {files.map((file) => (
                  <li className="space-y-2 py-4 first:pt-0 last:pb-0" key={file.id}>
                    <div className="flex items-start gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        {file.mediaType.startsWith("image/") ? <ImageIcon className="size-4" /> : <FileTextIcon className="size-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="break-all text-sm font-medium leading-relaxed">{file.sourcePath ?? file.displayName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{formatFileSize(file.byteSize)}{file.updatedAt ? ` · ${formatDate(file.updatedAt)}` : ""}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {file.versionNumber && <Badge variant="outline">v{file.versionNumber}</Badge>}
                          {file.isActiveVersion && <Badge variant="secondary">AI 当前使用</Badge>}
                          <Badge variant={file.status === "failed" ? "destructive" : "secondary"}>{getFileStatusLabel(file.status, file.mediaType)}</Badge>
                        </div>
                      </div>
                      {file.status !== "deleted" && <Button className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`删除 ${file.displayName}`} onClick={() => onRemoveFile(file.id)} size="icon-sm" type="button" variant="ghost"><Trash2Icon className="size-4" /></Button>}
                    </div>
                    {file.diagnostics.map((diagnostic) => (
                      <p className="break-words pl-12 text-xs leading-relaxed text-muted-foreground" key={`${diagnostic.stage}-${diagnostic.pageNumber ?? 0}-${diagnostic.message}`}>
                        {diagnostic.pageNumber ? `第 ${diagnostic.pageNumber} 页：` : ""}{diagnostic.message}
                      </p>
                    ))}
                    {file.visualAssets.map((asset) => (
                      <p className="break-words pl-12 text-xs leading-relaxed text-muted-foreground" key={`visual-${asset.sourceKey}`}>
                        {getVisualAssetLocation(asset.sourceKey, asset.pageNumber)}视觉分析：{getVisualAssetLabel(asset.status, asset.errorMessage)}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** 将字节数转换为紧凑的文件大小。 */
function formatFileSize(byteSize?: number) {
  if (byteSize === undefined) return "大小未知";
  if (byteSize < 1_024) return `${byteSize} B`;
  if (byteSize < 1_024 * 1_024) return `${(byteSize / 1_024).toFixed(1)} KB`;
  return `${(byteSize / 1_024 / 1_024).toFixed(1)} MB`;
}

/** 使用本地时间展示版本写入时间。 */
function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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

/**
 * 将服务端持久化的导入阶段转换为用户可见进度说明。
 *
 * @param stage 服务端当前阶段，网络上传期间尚不存在。
 * @param progressPercent 当前整体百分比，用于区分上传与等待 Workflow。
 */
function getImportProgressLabel(
  stage: ImportBatchState["progressStage"] | undefined,
  progressPercent: number,
) {
  if (!stage)
    return progressPercent >= 10
      ? "文件已保存，正在启动处理"
      : "正在上传文件";
  const labels: Record<ImportBatchState["progressStage"], string> = {
    queued: "文件已保存，正在排队",
    parsing: "正在解析文档",
    visualizing: "正在进行视觉识别",
    embedding: "正在生成向量索引",
    finalizing: "正在发布知识库快照",
    completed: "导入完成",
    failed: "导入失败",
  };
  return labels[stage];
}

function getFileStatusLabel(status: string, mediaType: string) {
  if (status === "completed" && [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ].includes(mediaType)) return "已发布";
  if (status === "completed" && !mediaType.startsWith("text/")) return "附件已保存";
  const labels: Record<string, string> = { completed: "已发布", ready: "附件已保存", running: "处理中", queued: "排队中", failed: "失败", deleted: "已删除" };
  return labels[status] ?? status;
}

/** 将跨格式视觉来源键转为简短、可核对的位置标签。 */
function getVisualAssetLocation(sourceKey: string, pageNumber: number | null) {
  if (pageNumber) return `第 ${pageNumber} 页`;
  const imageIndex = /^document-image:(\d+)$/.exec(sourceKey)?.[1];
  if (imageIndex) return `内嵌图片 ${imageIndex}`;
  const worksheetImage = /^worksheet-image:([^:]+):([A-Z]+\d+):(\d+)$/.exec(sourceKey);
  if (!worksheetImage) return "派生图片";
  try {
    return `工作表 ${decodeURIComponent(worksheetImage[1])} · ${worksheetImage[2]} · 内嵌图片 ${worksheetImage[3]}`;
  } catch {
    return "工作表内嵌图片";
  }
}

/** 将视觉分析的后台状态转换为导入面板可见文字。 */
function getVisualAssetLabel(status: string, errorMessage: string | null) {
  if (status === "completed") return "已完成";
  if (status === "running") return "处理中";
  if (status === "failed") return errorMessage ?? "失败";
  return status;
}
