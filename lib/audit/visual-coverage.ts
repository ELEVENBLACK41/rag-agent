/** 修改时间：2026-09-16 | 文件说明：将已存视觉失败、低置信度及未分析图片呈现为待核对项 | edit by：Sliye */
import { inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { visualAssets } from "@/lib/db/schema";
import {
  auditSource,
  type AuditFile,
  type AuditFinding,
} from "@/lib/audit/types";
import type { AuditImageReference } from "@/lib/audit/link-rules";

/** 当前快照最多读取的视觉状态数，旧图片反复更新也不能产生无界审计查询。 */
const MAX_VISUAL_RECORDS = 2_000;

/**
 * 只读已有视觉事实，不为审计启动新的模型调用；缺少状态时不猜测具体失败原因。
 * @param files 已授权的快照文件。
 * @param references Markdown 正文中唯一解析到的图片引用。
 * @param emit 有界报告写入器。
 */
export async function checkVisualCoverage(
  files: AuditFile[],
  references: AuditImageReference[],
  emit: (finding: Omit<AuditFinding, "id">) => void,
) {
  if (!files.length) return false;
  const assets = await getDatabase()
    .select({
      fileVersionId: visualAssets.fileVersionId,
      locator: visualAssets.sourceLocator,
      status: visualAssets.status,
      analysis: visualAssets.analysis,
    })
    .from(visualAssets)
    .where(
      inArray(
        visualAssets.fileVersionId,
        files.map((file) => file.id),
      ),
    )
    .orderBy(visualAssets.id)
    .limit(MAX_VISUAL_RECORDS + 1);
  // 记录不完整时不能把未读到的状态判为“未分析”。
  if (assets.length > MAX_VISUAL_RECORDS) return true;
  const seen = new Set<string>();
  for (const reference of references) {
    const key = `${reference.source.id}:${reference.image.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const asset = assets.find((item) => {
      const locator = item.locator as {
        kind?: string;
        attachmentFileVersionId?: string;
      };
      return (
        item.fileVersionId === reference.source.id &&
        locator.kind === "markdown-image" &&
        locator.attachmentFileVersionId === reference.image.id
      );
    });
    const confidence = (asset?.analysis as { confidence?: string } | null)
      ?.confidence;
    if (asset?.status === "completed" && confidence && confidence !== "low")
      continue;
    emit({
      kind: "unverified-image",
      severity: "info",
      confidence: "unverified",
      sources: [
        auditSource(reference.source, reference.line),
        auditSource(reference.image),
      ],
      evidence: !asset
        ? "当前图片版本没有已保存的视觉分析；数量/像素限制或分析前失败等情况可能导致跳过，现有记录无法确定具体原因。"
        : asset.status === "failed"
          ? "当前图片版本的视觉分析失败。"
          : asset.status !== "completed"
            ? "当前图片版本的视觉分析尚未完成。"
            : "已有图片描述的置信度较低或不可确认，不能当作确定事实。",
      suggestion:
        "核对原图；导入视觉分析每文件最多 2 张、每批最多 5 张，本次审计不自动补调模型。",
      requiresConfirmation: true,
    });
  }
  for (const asset of assets) {
    const locator = asset.locator as {
      kind?: string;
      pageNumber?: number;
      imageIndex?: number;
      sheetName?: string;
      anchor?: string;
    };
    if (locator.kind === "markdown-image") continue;
    if (
      asset.status === "completed" &&
      (asset.analysis as { confidence?: string } | null)?.confidence !== "low"
    )
      continue;
    const file = files.find((item) => item.id === asset.fileVersionId)!;
    const location =
      locator.kind === "pdf-page"
        ? `PDF 第 ${locator.pageNumber} 页`
        : locator.kind === "worksheet-image"
          ? `${locator.sheetName} · ${locator.anchor}`
          : `内嵌图片 ${locator.imageIndex}`;
    emit({
      kind: "unverified-image",
      severity: "info",
      confidence: "unverified",
      sources: [auditSource(file)],
      evidence: `${location}：已存视觉状态为${asset.status === "failed" ? "失败" : asset.status === "completed" ? "低置信度" : "未完成"}。`,
      suggestion:
        "下载原文件核对对应位置；本次不重新解析 Office/PDF，也不补调视觉模型。",
      requiresConfirmation: true,
    });
  }
  return false;
}
