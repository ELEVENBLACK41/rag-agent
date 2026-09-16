/** 修改时间：2026-09-16 | 文件说明：结构审计报告、覆盖范围、规则筛选与原文入口 | edit by：Sliye */
"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStructureAudit } from "@/components/audit/use-structure-audit";
import {
  AuditSourceDrawer,
  type AuditSelection,
} from "@/components/audit/audit-source-drawer";
import type { AuditFindingKind } from "@/lib/audit/types";

/** 稳定领域类型映射为面向用户的规则名称。 */
const FINDING_LABELS: Record<AuditFindingKind, string> = {
  "missing-link": "链接目标未找到",
  "missing-attachment": "附件未找到",
  "missing-anchor": "锚点未找到",
  "ambiguous-link": "链接目标歧义",
  "invalid-link": "链接路径无效",
  "exact-duplicate": "完全重复",
  "near-duplicate": "近重复候选",
  "unverified-image": "图片语义待核对",
};

/** 组合报告展示与异步 Hook，不在页面入口承担检查或授权逻辑。 */
export function StructureAudit() {
  const { data, loading, error, refresh, cancel } = useStructureAudit();
  const [filter, setFilter] = useState("all");
  const [selection, setSelection] = useState<AuditSelection | null>(null);
  const report = data?.report;
  const findings =
    report?.findings.filter(
      (finding) => filter === "all" || finding.kind === filter,
    ) ?? [];
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-5">
          <div>
            <h1 className="text-xl font-semibold">知识库结构审计</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              检查链接、附件和重复文件，保留依据与原文位置。
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/library">知识库</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/chat">返回聊天</Link>
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-5xl space-y-5 px-5 py-7">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={loading}
            onClick={() => {
              setSelection(null);
              void refresh(true);
            }}
          >
            重新检查
          </Button>
          <Button
            disabled={loading}
            variant="outline"
            onClick={() => {
              setSelection(null);
              void refresh();
            }}
          >
            刷新报告
          </Button>
          {loading && (
            <Button variant="ghost" onClick={cancel}>
              取消等待
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            导入后自动检查 · 不修改原文件 · 不调用模型
          </span>
        </div>
        {loading && (
          <p role="status" className="text-sm">
            正在读取或检查当前知识库，请稍候…
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {!loading && data && !report && (
          <Card>
            <CardContent className="py-6">
              <p>
                {data.snapshotId
                  ? "当前快照尚无可用报告。自动检查可能正在执行或未成功，请刷新报告或重新检查。"
                  : "知识库还没有已发布资料，请先导入文件。"}
              </p>
              <Button asChild variant="link">
                <Link href="/library">前往知识库</Link>
              </Button>
            </CardContent>
          </Card>
        )}
        {report && (
          <>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-3">
                  <CardTitle>检查结果 · {report.findings.length} 项</CardTitle>
                  <Badge
                    variant={
                      report.status === "partial" ? "outline" : "secondary"
                    }
                  >
                    {report.status === "partial"
                      ? "部分检查"
                      : "本次范围检查完成"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  文件 {report.coverage.checkedFiles} /{" "}
                  {report.coverage.totalFiles} · 已读文本{" "}
                  {report.coverage.textFiles} · 本地引用{" "}
                  {report.coverage.checkedLinks} · 近重复比较{" "}
                  {report.coverage.comparedPairs} 对
                </p>
                <p className="break-all text-muted-foreground">
                  {new Date(report.checkedAt).toLocaleString("zh-CN")} · 快照{" "}
                  {report.snapshotId} · 规则 {report.ruleVersion}
                </p>
                <p className="text-muted-foreground">
                  链接检查覆盖普通 Markdown/Wikilink、标题和 Block
                  ID；完全重复检查全部已检查文件，近重复仅比较 MD/TXT。外部链接{" "}
                  {report.coverage.externalLinks} 处未联网检查；Office/PDF
                  内部链接、复杂 Markdown 扩展和语义冲突不在本次范围。
                </p>
                {report.coverage.limitations.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {report.coverage.limitations.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-medium">待核对的问题</h2>
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger aria-label="筛选审计问题" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部类型</SelectItem>
                  {Object.entries(FINDING_LABELS).map(([kind, label]) => (
                    <SelectItem key={kind} value={kind}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!findings.length && (
              <p className="rounded-lg border p-5 text-sm text-muted-foreground">
                {report.findings.length
                  ? "当前筛选没有匹配项。"
                  : "在本次已覆盖范围内未发现问题；这不代表整个原 Vault 或所有语法均已验证。"}
              </p>
            )}
            {findings.map((finding) => (
              <Card key={finding.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">
                      {FINDING_LABELS[finding.kind]}
                    </CardTitle>
                    <Badge variant="outline">
                      {finding.severity === "warning" ? "警告" : "提示"}
                    </Badge>
                    <Badge variant="secondary">
                      {finding.confidence === "unverified"
                        ? "未验证候选"
                        : "规则依据明确"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {finding.target && (
                    <p className="break-all font-mono">
                      目标：{finding.target}
                    </p>
                  )}
                  <p>{finding.evidence}</p>
                  <p className="text-muted-foreground">
                    建议：{finding.suggestion}{" "}
                    {finding.requiresConfirmation && "需人工确认。"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {finding.sources.map((source) => (
                      <Button
                        key={`${source.fileVersionId}:${source.line}`}
                        variant="outline"
                        size="sm"
                        className="h-auto max-w-full whitespace-normal break-all py-2 text-left"
                        onClick={() =>
                          setSelection({
                            snapshotId: report.snapshotId,
                            source,
                          })
                        }
                      >
                        {source.path} · v{source.version} · 第 {source.line} 行
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </div>
      <AuditSourceDrawer
        key={
          selection
            ? `${selection.snapshotId}:${selection.source.fileVersionId}:${selection.source.line}`
            : "closed"
        }
        selection={selection}
        onClose={() => setSelection(null)}
      />
    </main>
  );
}
