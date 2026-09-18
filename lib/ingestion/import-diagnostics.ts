/**
 * 修改时间：2026-09-11 | 文件说明：VaultAgent 导入解析诊断的持久化查询 | edit by：Sliye
 */

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { importDiagnostics } from "@/lib/db/schema";
import type { ImportDiagnostic } from "@/lib/ingestion/formats/types";

/**
 * 以当前解析结果替换一个导入记录的诊断，保证 Workflow 重试不会累积重复警告。
 *
 * @param importId 导入记录标识。
 * @param diagnostics 本次解析产生的文件级或页级诊断。
 */
export async function replaceImportDiagnostics(
  importId: string,
  diagnostics: ImportDiagnostic[],
) {
  const db = getDatabase();
  await db.transaction(async (transaction) => {
    await transaction
      .delete(importDiagnostics)
      .where(eq(importDiagnostics.importId, importId));
    if (!diagnostics.length) return;
    await transaction.insert(importDiagnostics).values(
      diagnostics.map((diagnostic) => ({
        id: randomUUID(),
        importId,
        severity: diagnostic.severity,
        stage: diagnostic.stage,
        code: diagnostic.code,
        pageNumber: diagnostic.pageNumber ?? null,
        message: diagnostic.message,
      })),
    );
  });
}

/**
 * 按导入记录读取诊断，并按记录 ID 分组以供批次状态接口直接返回。
 *
 * @param importIds 同一导入批次中的导入记录标识。
 */
export async function getImportDiagnostics(importIds: string[]) {
  if (!importIds.length) return new Map<string, ImportDiagnostic[]>();
  const records = await getDatabase()
    .select({
      importId: importDiagnostics.importId,
      severity: importDiagnostics.severity,
      stage: importDiagnostics.stage,
      code: importDiagnostics.code,
      pageNumber: importDiagnostics.pageNumber,
      message: importDiagnostics.message,
    })
    .from(importDiagnostics)
    .where(inArray(importDiagnostics.importId, importIds))
    .orderBy(importDiagnostics.pageNumber);
  const result = new Map<string, ImportDiagnostic[]>();
  for (const record of records) {
    const diagnostics = result.get(record.importId) ?? [];
    diagnostics.push({
      severity: "warning",
      stage: "parse",
      code:
        record.code === "no-text-layer"
          ? "no-text-layer"
          : "text-extraction-failed",
      message: record.message,
      ...(record.pageNumber ? { pageNumber: record.pageNumber } : {}),
    });
    result.set(record.importId, diagnostics);
  }
  return result;
}
