/** 修改时间：2026-09-16 | 文件说明：导入发布后的独立结构审计步骤 | edit by：Sliye */
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { importBatches } from "@/lib/db/schema";
import { runStructureAudit } from "@/lib/audit/structure-audit";

/** 审计发布后的当前完整知识库；并发更新时由审计范围校验拒绝过期结果。
 * @param batchId 已成功发布的导入批次。
 */
export async function auditPublishedImport(batchId: string) {
  "use step";
  const [batch] = await getDatabase()
    .select({ workspaceId: importBatches.workspaceId })
    .from(importBatches)
    .where(eq(importBatches.id, batchId))
    .limit(1);
  if (!batch) throw new Error("审计对应的导入批次不存在。");
  await runStructureAudit(batch.workspaceId);
}
