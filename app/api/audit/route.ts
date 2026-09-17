/** 修改时间：2026-09-16 | 文件说明：当前身份知识库的结构审计查询与重新检查 API | edit by：Sliye */
import { canAccessD3LocalFeature } from "@/lib/auth/preview-import";
import { LOCAL_WORKSPACE_ID } from "@/lib/ingestion/imports";
import { AuditScopeChangedError, readCurrentAudit } from "@/lib/audit/repository";
import { runStructureAudit } from "@/lib/audit/structure-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 读取已保存报告；空库与尚未生成报告分别展示，不伪造零问题。 */
export async function GET(request: Request) { return respond(request, false); }
/** 重新检查当前发布快照，不接受客户端指定工作区或历史快照。 */
export async function POST(request: Request) { return respond(request, true); }

/** 同一访问边界处理读写；数据库/存储内部错误不返回浏览器。 */
async function respond(request: Request, refresh: boolean) {
  if (!canAccessD3LocalFeature(request)) return Response.json({ error: "当前部署模式不开放结构审计。" }, { status: 403 });
  try {
    if (refresh) await runStructureAudit(LOCAL_WORKSPACE_ID);
    return Response.json(await readCurrentAudit(LOCAL_WORKSPACE_ID), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const changed = error instanceof AuditScopeChangedError;
    return Response.json({ error: changed ? error.message : "结构审计读取或执行失败，请检查服务状态后重试。" }, { status: changed ? 409 : 500 });
  }
}
