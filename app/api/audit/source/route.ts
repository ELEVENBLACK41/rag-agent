/** 修改时间：2026-09-16 | 文件说明：审计来源的当前快照授权、原文定位与安全下载 | edit by：Sliye */
import { z } from "zod";
import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { LOCAL_WORKSPACE_ID } from "@/lib/ingestion/imports";
import {
  assertAuditScope,
  AuditScopeChangedError,
  currentAuditSnapshot,
  readAuditFiles,
} from "@/lib/audit/repository";
import { AUDIT_LIMITS } from "@/lib/audit/types";
import { readStoredFile } from "@/lib/storage/files";

export const runtime = "nodejs";
/** URL 入口只允许明确的版本和行号，禁止接受存储键或原始文件路径。 */
const sourceQuery = z.object({
  snapshot: z.string().uuid(),
  file: z.string().uuid(),
  line: z.coerce.number().int().min(1).max(1_000_000).default(1),
  download: z.enum(["1"]).optional(),
});

/** 校验当前快照成员后读取原文；删除或更新时旧入口立即失效。
 * @param request 来源 URL 查询参数。
 */
export async function GET(request: Request) {
  if (!canAccessD3LocalFeature(request))
    return Response.json(
      { error: "当前部署模式不开放来源读取。" },
      { status: 403 },
    );
  const parsed = sourceQuery.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success)
    return Response.json({ error: "来源参数无效。" }, { status: 400 });
  try {
    const query = parsed.data;
    if ((await currentAuditSnapshot(LOCAL_WORKSPACE_ID)) !== query.snapshot)
      throw new AuditScopeChangedError();
    const { files } = await readAuditFiles(LOCAL_WORKSPACE_ID, query.snapshot);
    const file = files.find((item) => item.id === query.file);
    if (!file)
      return Response.json(
        { error: "来源不存在或已不可访问。" },
        { status: 404 },
      );
    const isText = ["text/markdown", "text/plain"].includes(file.mediaType);
    const canPreview = isText && file.byteSize <= AUDIT_LIMITS.fileBytes;
    const bytes =
      query.download || canPreview
        ? await readStoredFile(file.storageKey)
        : null;
    await assertAuditScope(
      LOCAL_WORKSPACE_ID,
      query.snapshot,
      files.map((item) => item.id),
    );
    const headers = {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (query.download && bytes)
      return new Response(new Uint8Array(bytes), {
        headers: {
          ...headers,
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.path.split("/").at(-1)!)}`,
        },
      });
    const lines = bytes
      ? new TextDecoder("utf-8", { fatal: true })
          .decode(bytes)
          .replace(/\r\n?/g, "\n")
          .split("\n")
      : [];
    const start = Math.max(0, Math.min(query.line - 11, lines.length - 1));
    return Response.json(
      {
        path: file.path,
        version: file.version,
        line: query.line,
        startLine: start + 1,
        content: canPreview
          ? lines
              .slice(start, start + 35)
              .map((line) => line.slice(0, 2_000))
              .join("\n")
          : null,
        note: canPreview
          ? "显示定位行附近最多 35 行，每行最多 2,000 字符；完整内容请下载原文件。"
          : "此格式或文件大小不提供文本片段，请下载原文件核对。",
      },
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AuditScopeChangedError
            ? error.message
            : "原文读取失败，文件可能已删除或存储不可用。",
      },
      { status: error instanceof AuditScopeChangedError ? 409 : 500 },
    );
  }
}
