/** 修改时间：2026-09-16 | 文件说明：审计快照成员读取、报告持久化与来源访问校验 | edit by：Sliye */
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import {
  fileVersions,
  indexSnapshotFiles,
  indexSnapshots,
  logicalFiles,
  structureAuditReports,
} from "@/lib/db/schema";
import {
  AUDIT_LIMITS,
  AUDIT_RULE_VERSION,
  type AuditFile,
  type AuditReport,
} from "@/lib/audit/types";

/** 快照更新或文件撤销后不返回旧报告/原文。 */
export class AuditScopeChangedError extends Error {
  constructor() {
    super("知识库范围已变化，请刷新后重新检查。");
  }
}

/** 获取工作区最新发布快照，不接受浏览器提供的工作区身份。
 * @param workspaceId 由服务端身份边界确定的工作区。
 */
export async function currentAuditSnapshot(workspaceId: string) {
  const [snapshot] = await getDatabase()
    .select({ id: indexSnapshots.id })
    .from(indexSnapshots)
    .where(
      and(
        eq(indexSnapshots.workspaceId, workspaceId),
        eq(indexSnapshots.status, "published"),
      ),
    )
    .orderBy(desc(indexSnapshots.publishedAt), desc(indexSnapshots.id))
    .limit(1);
  return snapshot?.id ?? null;
}

/** 查询有界文件元数据；仅允许所属工作区、已发布快照和未删除的有效文件版本。 */
export async function readAuditFiles(workspaceId: string, snapshotId: string) {
  const db = getDatabase();
  const condition = and(
    eq(indexSnapshots.id, snapshotId),
    eq(indexSnapshots.workspaceId, workspaceId),
    eq(indexSnapshots.status, "published"),
    eq(logicalFiles.workspaceId, workspaceId),
    isNull(logicalFiles.deletedAt),
    inArray(fileVersions.status, ["indexed", "stored"]),
  );
  const query = db
    .select({
      id: fileVersions.id,
      sourcePath: logicalFiles.sourcePath,
      displayName: logicalFiles.displayName,
      mediaType: fileVersions.mediaType,
      contentHash: fileVersions.contentHash,
      byteSize: fileVersions.byteSize,
      version: fileVersions.versionNumber,
      storageKey: fileVersions.storageKey,
    })
    .from(indexSnapshotFiles)
    .innerJoin(
      indexSnapshots,
      eq(indexSnapshotFiles.snapshotId, indexSnapshots.id),
    )
    .innerJoin(
      fileVersions,
      eq(indexSnapshotFiles.fileVersionId, fileVersions.id),
    )
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .where(condition)
    .orderBy(logicalFiles.sourcePath, fileVersions.id)
    .limit(AUDIT_LIMITS.files);
  const totals = db
    .select({ value: count() })
    .from(indexSnapshotFiles)
    .innerJoin(
      indexSnapshots,
      eq(indexSnapshotFiles.snapshotId, indexSnapshots.id),
    )
    .innerJoin(
      fileVersions,
      eq(indexSnapshotFiles.fileVersionId, fileVersions.id),
    )
    .innerJoin(logicalFiles, eq(fileVersions.logicalFileId, logicalFiles.id))
    .where(condition);
  const [records, [total]] = await Promise.all([query, totals]);
  const files: (AuditFile & { storageKey: string })[] = records.map(
    ({ sourcePath, displayName, ...file }) => ({
      ...file,
      path: sourcePath ?? displayName,
    }),
  );
  return { files, totalFiles: total.value };
}

/** 返回报告前重新读取成员，防止生成中发生删除；原始存储键从不进入报告。 */
export async function assertAuditScope(
  workspaceId: string,
  snapshotId: string,
  fileIds: string[],
) {
  if ((await currentAuditSnapshot(workspaceId)) !== snapshotId)
    throw new AuditScopeChangedError();
  const { files } = await readAuditFiles(workspaceId, snapshotId);
  const actual = new Set(files.map((file) => file.id));
  if (actual.size !== fileIds.length || fileIds.some((id) => !actual.has(id)))
    throw new AuditScopeChangedError();
}

/** 只读取当前规则和当前快照的报告，变更后的知识库不能继续展示旧结果。 */
export async function readCurrentAudit(workspaceId: string) {
  const snapshotId = await currentAuditSnapshot(workspaceId);
  if (!snapshotId) return { snapshotId: null, report: null };
  const [stored] = await getDatabase()
    .select({ report: structureAuditReports.report })
    .from(structureAuditReports)
    .where(eq(structureAuditReports.snapshotId, snapshotId))
    .limit(1);
  if (!stored || stored.report.ruleVersion !== AUDIT_RULE_VERSION)
    return { snapshotId, report: null };
  const { files } = await readAuditFiles(workspaceId, snapshotId);
  const allowed = new Set(files.map((file) => file.id));
  if (
    stored.report.findings.some((finding) =>
      finding.sources.some((source) => !allowed.has(source.fileVersionId)),
    )
  )
    return { snapshotId, report: null };
  await assertAuditScope(
    workspaceId,
    snapshotId,
    files.map((file) => file.id),
  );
  return { snapshotId, report: stored.report };
}

/** 幂等保存快照报告；报告生成与导入索引状态分开，不将审计异常伪装成导入失败。 */
export async function saveAuditReport(report: AuditReport) {
  await getDatabase()
    .insert(structureAuditReports)
    .values({
      snapshotId: report.snapshotId,
      report,
      checkedAt: new Date(report.checkedAt),
    })
    .onConflictDoUpdate({
      target: structureAuditReports.snapshotId,
      set: { report, checkedAt: new Date(report.checkedAt) },
    });
}
