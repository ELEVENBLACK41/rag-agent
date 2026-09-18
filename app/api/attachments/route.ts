/** 修改时间：2026-09-17 | 文件说明：图片附件分页入口，校验部署权限与快照分页参数 | edit by：Sliye */
import { z } from "zod";
import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { listImageAttachments } from "@/lib/library/image-attachments";

/** 分页参数在不可信请求边界一次解析，后续页必须携带快照。 */
const querySchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    snapshotId: z.uuid().optional(),
  })
  .refine((query) => query.offset === 0 || !!query.snapshotId);

/** @param request 浏览器发出的同源分页请求。 */
export async function GET(request: Request) {
  if (!canAccessD3LocalFeature(request))
    return Response.json(
      { error: "当前部署不允许访问图片附件。" },
      { status: 403 },
    );
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success)
    return Response.json({ error: "图片分页参数无效。" }, { status: 400 });
  try {
    const page = await listImageAttachments(
      query.data.offset,
      query.data.snapshotId,
    );
    if (!page)
      return Response.json(
        { error: "知识库已更新，请刷新图片列表。" },
        { status: 409 },
      );
    return Response.json(page, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { error: "图片列表读取失败，请重试。" },
      { status: 500 },
    );
  }
}
