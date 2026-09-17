/** 修改时间：2026-09-16 | 文件说明：无模型调用的有界快照结构审计编排 | edit by：Sliye */
import { randomUUID } from "node:crypto";
import { readStoredFile } from "@/lib/storage/files";
import {
  auditDocument,
  checkLinks,
  type AuditDocument,
} from "@/lib/audit/link-rules";
import { checkDuplicates } from "@/lib/audit/duplicate-rules";
import { checkVisualCoverage } from "@/lib/audit/visual-coverage";
import {
  assertAuditScope,
  currentAuditSnapshot,
  readAuditFiles,
  saveAuditReport,
} from "@/lib/audit/repository";
import {
  AUDIT_LIMITS,
  AUDIT_RULE_VERSION,
  type AuditFinding,
  type AuditReport,
} from "@/lib/audit/types";

/**
 * 对当前已发布快照自动/手动执行规则检查，失败读取与资源截断均进入覆盖范围。
 * @param workspaceId 服务端已确认身份对应的工作区。
 */
export async function runStructureAudit(
  workspaceId: string,
): Promise<AuditReport | null> {
  const snapshotId = await currentAuditSnapshot(workspaceId);
  if (!snapshotId) return null;
  const { files, totalFiles } = await readAuditFiles(workspaceId, snapshotId);
  const documents: AuditDocument[] = [];
  const limitations: string[] = [];
  const findings: AuditFinding[] = [];
  let textBytes = 0;
  let skipped = 0;
  let failed = 0;
  let overflow = false;
  if (totalFiles > files.length)
    limitations.push(
      `当前仅检查前 ${files.length} 个文件；超出清单范围的链接不判为缺失。`,
    );
  for (const file of files) {
    if (file.mediaType !== "text/markdown" && file.mediaType !== "text/plain")
      continue;
    if (
      file.byteSize > AUDIT_LIMITS.fileBytes ||
      textBytes + file.byteSize > AUDIT_LIMITS.textBytes
    ) {
      skipped++;
      continue;
    }
    textBytes += file.byteSize;
    try {
      const bytes = await readStoredFile(file.storageKey);
      documents.push(
        auditDocument(
          file,
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        ),
      );
    } catch {
      failed++;
    }
  }
  if (skipped)
    limitations.push(
      `${skipped} 个文本文件超过单文件 1 MB 或总读取 10 MB 上限，未检查正文。`,
    );
  if (failed)
    limitations.push(
      `${failed} 个文本文件读取或 UTF-8 解码失败，请确认存储可用后重新检查。`,
    );
  const emit = (finding: Omit<AuditFinding, "id">) => {
    // 文件清单不完整时不能据此确认目标不存在。
    if (
      totalFiles > files.length &&
      ["missing-link", "missing-attachment", "ambiguous-link"].includes(
        finding.kind,
      )
    )
      return;
    if (findings.length >= AUDIT_LIMITS.findings) {
      overflow = true;
      return;
    }
    findings.push({ ...finding, id: randomUUID() });
  };
  const links = checkLinks(documents, files, emit);
  if (await checkVisualCoverage(files, links.images, emit))
    limitations.push("视觉状态记录超过 2,000 条，本次未检查视觉状态。");
  const duplicates = checkDuplicates(files, documents, emit);
  if (links.unchecked)
    limitations.push(
      `${links.unchecked} 处扩展语法、超限引用或非 Markdown/未读取目标的锚点未验证（最多检查 10,000 处引用）。`,
    );
  if (duplicates.excluded)
    limitations.push(
      `${duplicates.excluded} 个文本不在近重复长度范围（归一化后 80–20,000 字符），仅参与字节哈希重复检查。`,
    );
  if (duplicates.limited)
    limitations.push(
      `近重复比较达到 ${AUDIT_LIMITS.pairs} 对上限，其余组合未验证。`,
    );
  if (overflow)
    limitations.push(
      `发现超过 ${AUDIT_LIMITS.findings} 项，仅保存前 ${AUDIT_LIMITS.findings} 项。`,
    );
  const report: AuditReport = {
    snapshotId,
    ruleVersion: AUDIT_RULE_VERSION,
    checkedAt: new Date().toISOString(),
    status: limitations.length ? "partial" : "completed",
    coverage: {
      totalFiles,
      checkedFiles: files.length,
      textFiles: documents.length,
      checkedLinks: links.checkedLinks,
      comparedPairs: duplicates.comparedPairs,
      externalLinks: links.externalLinks,
      limitations,
    },
    findings,
  };
  await assertAuditScope(
    workspaceId,
    snapshotId,
    files.map((file) => file.id),
  );
  await saveAuditReport(report);
  return report;
}
