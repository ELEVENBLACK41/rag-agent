/** 修改时间：2026-09-16 | 文件说明：快照结构审计的报告、来源与覆盖范围契约 | edit by：Sliye */

/** 规则版本用于使旧报告失效，避免升级规则后仍展示旧检查结果。 */
export const AUDIT_RULE_VERSION = "structure-v1";
/** 审计资源上限独立于模型预算；达到上限必须呈现为部分检查。 */
export const AUDIT_LIMITS = { files: 500, textBytes: 10_000_000, fileBytes: 1_000_000, findings: 500, pairs: 5_000, references: 10_000 };

export type AuditFile = {
  id: string;
  path: string;
  mediaType: string;
  contentHash: string;
  byteSize: number;
  version: number;
};

export type AuditSource = { fileVersionId: string; path: string; version: number; line: number };
export type AuditFindingKind = "missing-link" | "missing-attachment" | "missing-anchor" | "ambiguous-link" | "invalid-link" | "exact-duplicate" | "near-duplicate" | "unverified-image";
export type AuditFinding = {
  id: string;
  kind: AuditFindingKind;
  severity: "warning" | "info";
  confidence: "high" | "unverified";
  sources: AuditSource[];
  target?: string;
  evidence: string;
  suggestion: string;
  requiresConfirmation: boolean;
};

export type AuditReport = {
  snapshotId: string;
  ruleVersion: string;
  checkedAt: string;
  status: "completed" | "partial";
  coverage: {
    totalFiles: number;
    checkedFiles: number;
    textFiles: number;
    checkedLinks: number;
    comparedPairs: number;
    externalLinks: number;
    limitations: string[];
  };
  findings: AuditFinding[];
};

/** 构造只包含公开定位信息的来源，不暴露存储键。
 * @param file 固定快照内的文件版本。
 * @param line 原文一基行号。
 */
export function auditSource(file: AuditFile, line = 1): AuditSource {
  return { fileVersionId: file.id, path: file.path, version: file.version, line };
}
