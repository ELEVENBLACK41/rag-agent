/**
 * 修改时间：2026-09-10 | 文件说明：VaultAgent D4 多文件与 ZIP 导入 API | edit by：Sliye
 */

import { z } from "zod";
import { start } from "workflow/api";
import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { ImportValidationError } from "@/lib/ingestion/errors";
import { collectVaultUploadFiles } from "@/lib/ingestion/intake";
import {
  createLocalImportBatch,
  recordImportBatchDispatchError,
  setImportBatchWorkflowRun,
} from "@/lib/ingestion/imports";
import { ingestImportBatchWorkflow } from "@/workflows/ingest-import-batch";

export const runtime = "nodejs";

const importPathsSchema = z.array(z.string().min(1).max(1_024)).max(50);

/**
 * 创建多文件候选快照并启动持久化索引。浏览器可为每个文件提供 Vault 内相对路径。
 *
 * @param request 仅接受 multipart/form-data 的 HTTP 请求。
 */
export async function POST(request: Request) {
  if (!canAccessD3LocalFeature(request)) {
    return Response.json({ error: "Import is unavailable in this deployment mode." }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const uploads = [...formData.getAll("files"), ...formData.getAll("file")].filter(
      (item): item is File => item instanceof File,
    );
    const paths = parseRelativePaths(formData.get("paths"), uploads.length);
    const files = await collectVaultUploadFiles(
      uploads.map((file, index) => ({ file, relativePath: paths[index] ?? file.name })),
    );
    const createdBatch = await createLocalImportBatch(files);

    try {
       // https://useworkflow.dev/docs/api-reference/workflow-api/start 见官网详细说明
      /**
       * start()会对新的工作流运行进行队列并返回一个对象Run
       */
    const run = await start(ingestImportBatchWorkflow, [createdBatch.batchId]);
      await setImportBatchWorkflowRun(createdBatch.batchId, run.runId);
      return Response.json({ batchId: createdBatch.batchId, status: "queued" }, { status: 202 });
    } catch {
      await recordImportBatchDispatchError(createdBatch.batchId);
      return Response.json(
        { batchId: createdBatch.batchId, status: "failed", error: "Workflow dispatch failed." },
        { status: 503 },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法创建导入任务。";
    const status = error instanceof ImportValidationError || error instanceof z.ZodError ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}

/** 仅在传入路径数量与文件数量一致时使用客户端路径，避免服务端猜测错位。 */
function parseRelativePaths(value: FormDataEntryValue | null, fileCount: number) {
  if (typeof value !== "string") return [];
  let rawPaths: unknown;
  try {
    rawPaths = JSON.parse(value);
  } catch {
    throw new ImportValidationError("文件路径格式无效。");
  }
  const parsed = importPathsSchema.parse(rawPaths);
  if (parsed.length !== fileCount) throw new ImportValidationError("文件路径数量与上传文件不一致。");
  return parsed;
}
