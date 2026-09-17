/** 修改时间：2026-09-16 | 文件说明：持久工作区右侧的结构审计报告、筛选与原文入口 | edit by：Sliye */
"use client";
import Link from "next/link";
import { useState } from "react";
import { ClipboardCheckIcon, LoaderCircleIcon, RefreshCwIcon, ScanSearchIcon } from "lucide-react";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";
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
    <main className="min-h-full bg-background text-foreground">
      <WorkspacePageHeader
        title="知识库结构审计"
        description="检查链接、附件和重复文件，保留依据与原文位置"
        icon={ClipboardCheckIcon}
      />
      <div className="mx-auto max-w-6xl space-y-6 px-4 pb-10 sm:px-8">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted/40 p-4">
          <Button
            className="rounded-lg"
            disabled={loading}
            onClick={() => {
              setSelection(null);
              void refresh(true);
            }}
          >
            <ScanSearchIcon aria-hidden="true" className="size-4" />重新检查
          </Button>
          <Button
            disabled={loading}
            variant="outline"
            className="rounded-lg bg-background"
            onClick={() => {
              setSelection(null);
              void refresh();
            }}
          >
            <RefreshCwIcon aria-hidden="true" className="size-4" />刷新报告
          </Button>
          {loading && (
            <Button variant="ghost" onClick={cancel}>
              取消等待
            </Button>
          )}
          <span className="w-full text-xs leading-relaxed text-muted-foreground xl:ml-auto xl:w-auto">
            导入后自动检查
          </span>
        </div>
        {loading && (
          <p role="status" className="flex items-center gap-2 rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">
            <LoaderCircleIcon aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
            正在读取或检查当前知识库，请稍候…
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {!loading && data && !report && (
          <Card className="rounded-2xl ring-border [--card-spacing:--spacing(5)]">
            <CardContent className="py-8 text-center">
              <ClipboardCheckIcon aria-hidden="true" className="mx-auto mb-4 size-7 text-muted-foreground" />
              <p className="mx-auto max-w-lg text-sm leading-relaxed text-muted-foreground">
                {data.snapshotId
                  ? "当前快照尚无可用报告。自动检查可能正在执行或未成功，请刷新报告或重新检查。"
                  : "知识库还没有已发布资料，请先导入文件。"}
              </p>
              <Button asChild variant="outline" className="mt-5 rounded-lg">
                <Link href="/library">前往知识库</Link>
              </Button>
            </CardContent>
          </Card>
        )}
        {report && (
          <>
            <Card className="rounded-2xl ring-border [--card-spacing:--spacing(5)]">
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
              <CardContent className="space-y-4 text-sm leading-relaxed">
                <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <div className="rounded-xl bg-muted/50 p-4">
                    <dt className="text-xs text-muted-foreground">已检查文件</dt>
                    <dd className="mt-2 text-2xl font-semibold tabular-nums">{report.coverage.checkedFiles}<span className="text-sm font-normal text-muted-foreground"> / {report.coverage.totalFiles}</span></dd>
                  </div>
                  <div className="rounded-xl bg-muted/50 p-4">
                    <dt className="text-xs text-muted-foreground">已读文本</dt>
                    <dd className="mt-2 text-2xl font-semibold tabular-nums">{report.coverage.textFiles}</dd>
                  </div>
                  <div className="rounded-xl bg-muted/50 p-4">
                    <dt className="text-xs text-muted-foreground">本地引用</dt>
                    <dd className="mt-2 text-2xl font-semibold tabular-nums">{report.coverage.checkedLinks}</dd>
                  </div>
                  <div className="rounded-xl bg-muted/50 p-4">
                    <dt className="text-xs text-muted-foreground">近重复比较</dt>
                    <dd className="mt-2 text-2xl font-semibold tabular-nums">{report.coverage.comparedPairs}<span className="text-sm font-normal text-muted-foreground"> 对</span></dd>
                  </div>
                </dl>
                <p className="break-all text-xs text-muted-foreground">
                  {new Date(report.checkedAt).toLocaleString("zh-CN")} · 快照{" "}
                  {report.snapshotId} · 规则 {report.ruleVersion}
                </p>
                <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
                  链接检查覆盖普通 Markdown/Wikilink、标题和 Block
                  ID；完全重复检查全部已检查文件，近重复仅比较 MD/TXT。外部链接{" "}
                  {report.coverage.externalLinks} 处未联网检查；Office/PDF
                  内部链接、复杂 Markdown 扩展和语义冲突不在本次范围。
                </p>
                {report.coverage.limitations.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {report.coverage.limitations.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">待核对的问题<Badge variant="secondary" className="tabular-nums">{findings.length}</Badge></h2>
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger aria-label="筛选审计问题" className="w-full rounded-lg bg-card sm:w-48">
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
              <p role="status" className="rounded-2xl border border-dashed bg-muted/30 px-5 py-10 text-center text-sm leading-relaxed text-muted-foreground">
                {report.findings.length
                  ? "当前筛选没有匹配项。"
                  : "在本次已覆盖范围内未发现问题；这不代表整个原 Vault 或所有语法均已验证。"}
              </p>
            )}
            {findings.map((finding) => (
              <Card key={finding.id} className="min-w-0 rounded-2xl ring-border [--card-spacing:--spacing(5)]">
                <CardHeader>
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
                <CardContent className="space-y-3 break-words text-sm leading-relaxed">
                  {finding.target && (
                    <p className="rounded-lg bg-muted/50 px-3 py-2 break-all font-mono text-xs">
                      目标：{finding.target}
                    </p>
                  )}
                  <p>{finding.evidence}</p>
                  <p className="text-muted-foreground">
                    建议：{finding.suggestion}{" "}
                    {finding.requiresConfirmation && "需人工确认。"}
                  </p>
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    {finding.sources.map((source) => (
                      <Button
                        key={`${source.fileVersionId}:${source.line}`}
                        variant="outline"
                        size="sm"
                        className="h-auto max-w-full justify-start rounded-lg whitespace-normal break-all py-2 text-left text-xs"
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
