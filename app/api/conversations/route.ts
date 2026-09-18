/** 修改时间：2026-09-16 | 文件说明：当前工作区的分页会话列表入口 | edit by：Sliye */
import { z } from "zod";
import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { listConversations } from "@/lib/chat/conversations";

export const runtime = "nodejs";
/** 查询参数仅在 API 入口解析，业务层接收准确的分页数值。 */
const offsetSchema = z.coerce.number().int().min(0).max(1_000_000);

/** @param request 带可选 offset 的受保护请求。 */
export async function GET(request: Request) {
  if (!canAccessD3LocalFeature(request))
    return Response.json(
      { error: "此环境不可访问聊天历史。" },
      { status: 403 },
    );
  const offset = offsetSchema.safeParse(
    new URL(request.url).searchParams.get("offset") ?? 0,
  );
  if (!offset.success)
    return Response.json({ error: "会话分页参数无效。" }, { status: 400 });
  try {
    return Response.json(await listConversations(offset.data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "无法读取会话列表，请重试。" },
      { status: 500 },
    );
  }
}
