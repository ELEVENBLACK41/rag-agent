/** 修改时间：2026-09-16 | 文件说明：快照内链接、附件与锚点的确定性检查 | edit by：Sliye */
import path from "node:path";
import {
  inspectMarkdown,
  normalizeHeading,
  type MarkdownStructure,
} from "@/lib/audit/markdown";
import {
  AUDIT_LIMITS,
  auditSource,
  type AuditFile,
  type AuditFinding,
} from "@/lib/audit/types";

export type AuditDocument = {
  file: AuditFile;
  text: string;
  structure?: MarkdownStructure;
};
export type AuditImageReference = {
  source: AuditFile;
  image: AuditFile;
  line: number;
};

/** 解析文本文件的结构，只对 Markdown 启用链接规则。
 * @param file 快照内文件元数据。
 * @param text 原始 UTF-8 文本。
 */
export function auditDocument(file: AuditFile, text: string): AuditDocument {
  return {
    file,
    text,
    ...(file.mediaType === "text/markdown"
      ? { structure: inspectMarkdown(text) }
      : {}),
  };
}

/**
 * 只根据当前导入范围判断目标；外部链接不发起网络请求，无法检查的锚点明确计入覆盖缺口。
 * @param documents 成功读取的有界文本集合。
 * @param files 当前快照文件清单。
 * @param emit 将发现送入有界报告。
 */
export function checkLinks(
  documents: AuditDocument[],
  files: AuditFile[],
  emit: (finding: Omit<AuditFinding, "id">) => void,
) {
  const structures = new Map(
    documents.map((document) => [document.file.id, document.structure]),
  );
  let checkedLinks = 0;
  let externalLinks = 0;
  let unchecked = 0;
  const images: AuditImageReference[] = [];
  for (const document of documents) {
    unchecked += document.structure?.unsupported ?? 0;
    for (const reference of document.structure?.references ?? []) {
      if (checkedLinks + externalLinks >= AUDIT_LIMITS.references) {
        unchecked++;
        continue;
      }
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference.target)) {
        externalLinks++;
        continue;
      }
      checkedLinks++;
      const hashIndex = reference.target.indexOf("#");
      let anchor: string;
      let fileTarget: string;
      try {
        anchor =
          hashIndex < 0
            ? ""
            : decodeURIComponent(reference.target.slice(hashIndex + 1));
        fileTarget = decodeURIComponent(
          (hashIndex < 0
            ? reference.target
            : reference.target.slice(0, hashIndex)
          ).split("?")[0],
        );
      } catch {
        emitIssue(
          "invalid-link",
          "链接包含无效 URL 编码。",
          "修正原文链接编码。",
          [],
        );
        continue;
      }
      const resolution = resolveTarget(
        document.file,
        fileTarget,
        reference.wiki,
        files,
      );
      if (resolution === "invalid") {
        emitIssue(
          "invalid-link",
          "链接不是有效的 Vault 内相对路径。",
          "使用知识库范围内的相对路径。",
          [],
        );
        continue;
      }
      if (
        resolution.length === 1 &&
        reference.embedded &&
        /^image\/(png|jpeg)$/.test(resolution[0].mediaType)
      )
        images.push({
          source: document.file,
          image: resolution[0],
          line: reference.line,
        });
      if (!resolution.length) {
        const attachment =
          /\.(?!md$|txt$)[a-z\d]+$/i.test(fileTarget) ||
          (reference.embedded && !reference.wiki);
        emitIssue(
          attachment ? "missing-attachment" : "missing-link",
          "当前导入范围内未找到目标；不能据此认定原 Vault 损坏。",
          "确认目标路径，或将关联文件一并导入。",
          [],
        );
      } else if (resolution.length > 1) {
        emitIssue(
          "ambiguous-link",
          "存在多个同名候选，无法唯一确定目标。",
          "在原文链接中补全 Vault 相对路径。",
          resolution.slice(0, 10),
        );
      } else if (anchor) {
        const destination = resolution[0];
        const structure = structures.get(destination.id);
        if (!structure) {
          unchecked++;
          continue;
        }
        if (
          !structure.anchors.has(
            anchor.startsWith("^") ? anchor : normalizeHeading(anchor),
          )
        ) {
          if (structure.unsupported) {
            unchecked++;
            continue;
          }
          emitIssue(
            "missing-anchor",
            "目标文件存在，但未找到对应标题或 Block ID。",
            "核对标题或 Block ID；特殊 Markdown 扩展需人工确认。",
            [destination],
          );
        }
      }

      /** 将同一引用的定位、依据与目标版本一起记录，避免只显示无法复查的数量。 */
      function emitIssue(
        kind: AuditFinding["kind"],
        evidence: string,
        suggestion: string,
        related: AuditFile[],
      ) {
        emit({
          kind,
          severity: "warning",
          confidence: "high",
          sources: [
            auditSource(document.file, reference.line),
            ...related
              .filter((file) => file.id !== document.file.id)
              .map((file) => auditSource(file)),
          ],
          target: reference.target,
          evidence,
          suggestion,
          requiresConfirmation: true,
        });
      }
    }
  }
  return { checkedLinks, externalLinks, unchecked, images };
}

/** 解析相对路径时允许合法 ../，但不得越过 Vault 根；Wiki 才允许省略 .md。 */
function resolveTarget(
  source: AuditFile,
  target: string,
  wiki: boolean,
  files: AuditFile[],
): AuditFile[] | "invalid" {
  if (!target) return [source];
  if (/^[a-z][a-z\d+.-]*:|^[/\\]|\0/i.test(target) || target.includes("\\"))
    return "invalid";
  const relative = path.posix.normalize(
    path.posix.join(path.posix.dirname(source.path), target),
  );
  if (relative === ".." || relative.startsWith("../")) return "invalid";
  const names = (value: string) =>
    wiki && !path.posix.extname(value) ? [value, `${value}.md`] : [value];
  for (const candidate of [relative, path.posix.normalize(target)]) {
    const matches = files.filter((file) =>
      names(candidate).includes(file.path),
    );
    if (matches.length) return matches;
  }
  if (target.includes("/")) return [];
  return files.filter((file) =>
    names(target).includes(path.posix.basename(file.path)),
  );
}
