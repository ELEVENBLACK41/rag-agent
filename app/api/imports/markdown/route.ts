/**
 * 修改时间：2026-09-07 | 文件说明：VaultAgent D3 Markdown 导入 API | edit by：Sliye
 */

import { start } from "workflow/api";
import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import {
  createLocalMarkdownImport,
  recordImportDispatchError,
  setImportWorkflowRun,
} from "@/lib/ingestion/imports";
import { ingestMarkdownWorkflow } from "@/workflows/ingest-markdown";

export const runtime = "nodejs";

/** 单个 Markdown 文件允许的最大字节数：10 MB。 */
const MAX_MARKDOWN_BYTES = 10 * 1024 * 1024;

/**
 * 将一个 Markdown 文件排入仅限本地模式的持久化导入任务。
 *
 * @param request 仅接受 multipart/form-data 的 HTTP 请求。
 */
export async function POST(request: Request) {
  if (!canAccessD3LocalFeature(request)) {
    return Response.json({ error: "Markdown import is unavailable in this deployment mode." }, { status: 403 });
  }

  const formData = await request.formData();
  const uploads = formData.getAll("file");
  const [upload] = uploads;

  if (uploads.length !== 1 || !(upload instanceof File)) {
    return Response.json({ error: "Provide one Markdown file in the file field." }, { status: 400 });
  }
  if (!upload.name.toLowerCase().endsWith(".md")) {
    return Response.json({ error: "Only .md files are supported during D2." }, { status: 415 });
  }
  if (!upload.size || upload.size > MAX_MARKDOWN_BYTES) {
    return Response.json({ error: "Markdown must be between 1 byte and 10 MB." }, { status: 413 });
  }
  /**
   * 用户上传的md文档转换未字节数据，并创建一个本地的md导入记录
   */
  const createdImport = await createLocalMarkdownImport(upload.name, new Uint8Array(await upload.arrayBuffer()));

  try {
    // https://useworkflow.dev/docs/api-reference/workflow-api/start 见官网详细说明
    /**
     * start()会对新的工作流运行进行队列并返回一个对象Run
     */
    const run = await start(ingestMarkdownWorkflow, [createdImport.importId]);
    await setImportWorkflowRun(createdImport.importId, run.runId);
    return Response.json({ importId: createdImport.importId, status: "queued" }, { status: 202 });
  } catch {
    await recordImportDispatchError(createdImport.importId);
    return Response.json(
      { importId: createdImport.importId, status: "failed", error: "Workflow dispatch failed." },
      { status: 503 },
    );
  }
}
