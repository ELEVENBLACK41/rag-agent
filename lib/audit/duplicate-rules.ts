/** 修改时间：2026-09-16 | 文件说明：文件哈希完全重复与有界文本近重复候选检查 | edit by：Sliye */
import {
  AUDIT_LIMITS,
  auditSource,
  type AuditFile,
  type AuditFinding,
} from "@/lib/audit/types";
import type { AuditDocument } from "@/lib/audit/link-rules";

/** 近重复只比较有足够文本且长度可控的文件，避免短标题产生大量误报。 */
const MIN_SIMILAR_TEXT = 80;
/** 不截断长文后冒充全文比较；超过此限制明确计入覆盖缺口。 */
const MAX_SIMILAR_TEXT = 20_000;

/**
 * 原始字节哈希确认完全重复；字符五元组 Jaccard 只生成需人工确认的近重复候选。
 * @param files 快照文件清单，涵盖附件和二进制文档。
 * @param documents 成功读取的 MD/TXT 原文。
 * @param emit 有界发现写入器。
 */
export function checkDuplicates(
  files: AuditFile[],
  documents: AuditDocument[],
  emit: (finding: Omit<AuditFinding, "id">) => void,
) {
  const groups = new Map<string, AuditFile[]>();
  for (const file of files)
    groups.set(file.contentHash, [
      ...(groups.get(file.contentHash) ?? []),
      file,
    ]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    emit({
      kind: "exact-duplicate",
      severity: "info",
      confidence: "high",
      sources: group.map((file) => auditSource(file)),
      evidence: "这些不同路径文件的原始字节 SHA-256 相同。",
      suggestion: "确认是否为有意复制；本检查不会删除或合并文件。",
      requiresConfirmation: true,
    });
  }
  let excluded = 0;
  const candidates = documents.flatMap(({ file, text }) => {
    const normalized = text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
    if (
      normalized.length < MIN_SIMILAR_TEXT ||
      normalized.length > MAX_SIMILAR_TEXT
    ) {
      excluded++;
      return [];
    }
    const shingles = new Set<string>();
    for (let index = 0; index <= normalized.length - 5; index++)
      shingles.add(normalized.slice(index, index + 5));
    return [{ file, shingles }];
  });
  let comparedPairs = 0;
  let limited = false;
  outer: for (let left = 0; left < candidates.length; left++) {
    for (let right = left + 1; right < candidates.length; right++) {
      const a = candidates[left];
      const b = candidates[right];
      if (a.file.contentHash === b.file.contentHash) continue;
      if (comparedPairs >= AUDIT_LIMITS.pairs) {
        limited = true;
        break outer;
      }
      comparedPairs++;
      if (
        Math.min(a.shingles.size, b.shingles.size) /
          Math.max(a.shingles.size, b.shingles.size) <
        0.85
      )
        continue;
      let shared = 0;
      for (const shingle of a.shingles) if (b.shingles.has(shingle)) shared++;
      if (shared / (a.shingles.size + b.shingles.size - shared) < 0.85)
        continue;
      emit({
        kind: "near-duplicate",
        severity: "info",
        confidence: "unverified",
        sources: [auditSource(a.file), auditSource(b.file)],
        evidence:
          "归一化文本字符五元组 Jaccard ≥ 0.85；这只是文本相似候选，不证明语义等价。",
        suggestion: "对照两个版本的原文，重点检查数字、条件和结论差异。",
        requiresConfirmation: true,
      });
    }
  }
  return { comparedPairs, limited, excluded };
}
