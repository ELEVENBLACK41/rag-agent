/**
 * 修改时间：2026-09-11 | 文件说明：VaultAgent 多文件与 ZIP 导入 API | edit by：Sliye
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

/** 单次请求中的客户端 Vault 相对路径数组。 */
const importPathsSchema = z.array(z.string().min(1).max(1_024)).max(50);

/**
 * 创建多文件候选快照并启动持久化索引。浏览器可为每个文件提供 Vault 内相对路径。
 *
 * @param request 仅接受 multipart/form-data 的 HTTP 请求。
 */
export async function POST(request: Request) {
  if (!canAccessD3LocalFeature(request)) {
    return Response.json(
      { error: "Import is unavailable in this deployment mode." },
      { status: 403 },
    );
  }

  try {
    const formData = await request.formData();
    const uploads = [...formData.getAll("files"), ...formData.getAll("file")].filter(
      (item): item is File => item instanceof File,
    );
    const paths = parseRelativePaths(formData.get("paths"), uploads.length);
    //走文件导入逻辑
    const files = await collectVaultUploadFiles(
      /**
       * 遍历所有上传文件
       * file：浏览器 FormData 里的原始 File 对象，包含文件名、大小、MIME 和读取文件字节的方法
       * index：当前文件在上传数组中的位置，用来和 paths[index] 配对
       * 交给collectVaultUploadFiles去判断检查，是否合法，如：是否至少一个文件，是否超过50个文件等等 大小
       */
      uploads.map((file, index) => ({
        file,
        relativePath: paths[index] ?? file.name,
      })),
    );

    /**
     * 把已校验的上传文件真正登记为一次待处理的导入批次，并先把原始文件写入存储；成功后才允许 Workflow 开始解析
     */
    const createdBatch = await createLocalImportBatch(files);

    try {
      // https://useworkflow.dev/docs/api-reference/workflow-api/start
      //开启workflow “解析 → 可选视觉分析 → 向量化 → 快照发布”处理本批文件。
      const run = await start(ingestImportBatchWorkflow, [createdBatch.batchId]);
      await setImportBatchWorkflowRun(createdBatch.batchId, run.runId);
      return Response.json(
        { batchId: createdBatch.batchId, status: "queued" },
        { status: 202 },
      );
    } catch {
      await recordImportBatchDispatchError(createdBatch.batchId);
      return Response.json(
        {
          batchId: createdBatch.batchId,
          status: "failed",
          error: "Workflow dispatch failed.",
        },
        { status: 503 },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法创建导入任务。";
    const status =
      error instanceof ImportValidationError || error instanceof z.ZodError
        ? 400
        : 500;
    return Response.json({ error: message }, { status });
  }
}

/** 仅在路径数量与文件数量一致时使用客户端路径，避免服务端猜测错位。 */
function parseRelativePaths(value: FormDataEntryValue | null, fileCount: number) {
  if (typeof value !== "string") return [];
  let rawPaths: unknown;
  try {
    rawPaths = JSON.parse(value);
  } catch {
    throw new ImportValidationError("文件路径格式无效。");
  }
  const parsed = importPathsSchema.parse(rawPaths);
  if (parsed.length !== fileCount)
    throw new ImportValidationError("文件路径数量与上传文件不一致。");
  return parsed;
}
