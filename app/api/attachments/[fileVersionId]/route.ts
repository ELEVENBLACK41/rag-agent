/** 修改时间：2026-09-17 | 文件说明：按已发布快照鉴权返回图片字节，隐藏实际存储位置 | edit by：Sliye */
import { z } from "zod";
import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { readImageAttachment } from "@/lib/library/image-attachments";

/** 图片与快照身份均为服务端生成的 UUID。 */
const imageRequestSchema = z.object({
  fileVersionId: z.uuid(),
  snapshotId: z.uuid(),
});

/**
 * 返回受控 PNG/JPEG，禁用公共缓存及 MIME 嗅探。
 * @param request 同源图片请求。
 * @param context Next.js 动态路由参数。
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ fileVersionId: string }> },
) {
  if (!canAccessD3LocalFeature(request))
    return new Response(null, { status: 403 });
  const parsed = imageRequestSchema.safeParse({
    ...(await context.params),
    snapshotId: new URL(request.url).searchParams.get("snapshotId"),
  });
  if (!parsed.success) return new Response(null, { status: 400 });
  try {
    const image = await readImageAttachment(
      parsed.data.fileVersionId,
      parsed.data.snapshotId,
    );
    if (!image) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "Content-Type": image.mediaType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch {
    return new Response(null, { status: 500 });
  }
}
