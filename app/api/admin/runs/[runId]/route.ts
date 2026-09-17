/** 修改时间：2026-09-17 | 文件说明：独立校验所有者身份的运行详情导出 | edit by：Sliye */
import { z } from "zod";
import { isOwner } from "@/lib/auth/owner";
import { getMonitorRun } from "@/lib/monitoring/repository";

/** @param request HTTP 请求。 @param context 路由标识，不能信任隐藏管理入口。 */
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  void request;
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!(await isOwner()))
    return Response.json(
      { error: "需要所有者身份。" },
      { status: 403, headers },
    );
  const parsed = z
    .string()
    .uuid()
    .safeParse((await context.params).runId);
  if (!parsed.success)
    return Response.json({ error: "无效运行标识。" }, { status: 400, headers });
  const detail = await getMonitorRun(parsed.data);
  if (!detail)
    return Response.json(
      { error: "运行不存在或已删除。" },
      { status: 404, headers },
    );
  return Response.json(detail, {
    headers: {
      ...headers,
      "Content-Disposition": `attachment; filename="run-${parsed.data}.json"`,
    },
  });
}
