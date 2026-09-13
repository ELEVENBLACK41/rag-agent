/**
 * 修改时间：2026-09-12
 * 文件说明：VaultAgent 跨格式派生图片的保存、结构化分析与视觉 Chunk 写入。
 *
 * PDF、DOCX 和 XLSX 都只负责找出受限图片与其原始位置；本模块统一负责
 * 私有派生文件、模型版本、失败状态和可检索描述，避免复制视觉调用与事务逻辑。
 *
 * edit by：Sliye
 */

import { createHash, randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { chunks, visualAssets } from "@/lib/db/schema";
import { getErrorMessage } from "@/lib/ingestion/errors";
import {
  analyzeImage,
  VISUAL_MODEL,
  VISUAL_PROMPT_VERSION,
} from "@/lib/ingestion/visual/analyze-image";
import type { SourceLocator } from "@/lib/ingestion/formats/types";
import type {
  VisualAnalysis,
  VisualSourceLocator,
} from "@/lib/ingestion/visual/types";
import {
  createDerivedStorageKey,
  writeStoredFile,
} from "@/lib/storage/files";

type SupportedVisualMediaType = "image/png" | "image/jpeg";

export type StoredImageAnalysisInput = {
  importId: string;
  fileVersionId: string;
  snapshotId: string;
  workspaceId: string;
  sourceLocator: VisualSourceLocator;
  sourceKey: string;
  image: Uint8Array;
  mediaType: SupportedVisualMediaType;
  chunkLocator: (assetId: string) => SourceLocator;
  chunkLabel: string;
};

/**
 * 保存受限图片，调用视觉模型，并在成功时添加绑定原文件位置的检索 Chunk。
 * 失败资产也会落库，调用方可以继续完成文本导入而向用户展示真实状态。
 *
 * @param input 已通过格式专属限额和来源校验的派生图片信息。
 */
export async function analyzeAndStoreImage(input: StoredImageAnalysisInput) {
  const db = getDatabase();
  const assetId = randomUUID();
  const dimensions = readImageDimensions(input.image, input.mediaType);
  const storageKey = createDerivedStorageKey(
    input.workspaceId,
    assetId,
    input.mediaType,
  );
  await writeStoredFile(storageKey, input.image);
  await db.insert(visualAssets).values({
    id: assetId,
    importId: input.importId,
    fileVersionId: input.fileVersionId,
    sourceKey: input.sourceKey,
    sourceLocator: input.sourceLocator,
    pageNumber:
      input.sourceLocator.kind === "pdf-page"
        ? input.sourceLocator.pageNumber
        : null,
    mediaType: input.mediaType,
    storageKey,
    contentHash: createHash("sha256").update(input.image).digest("hex"),
    width: dimensions.width,
    height: dimensions.height,
    status: "running",
    modelId: VISUAL_MODEL,
    promptVersion: VISUAL_PROMPT_VERSION,
  });

  try {
    const analysis = await analyzeImage(input.image, input.mediaType);
    await storeCompletedVisualAnalysis({ ...input, assetId, analysis });
    return assetId;
  } catch (error) {
    await db
      .update(visualAssets)
      .set({
        status: "failed",
        errorMessage: getErrorMessage(error, "Visual analysis failed."),
        completedAt: new Date(),
      })
      .where(eq(visualAssets.id, assetId));
    throw error;
  }
}

/** 用一个事务提交模型结果和对应视觉 Chunk，防止出现“成功但无法检索”的半成品。 */
async function storeCompletedVisualAnalysis(
  input: StoredImageAnalysisInput & { assetId: string; analysis: VisualAnalysis },
) {
  const content = `${input.chunkLabel}\n${input.analysis.description}\n可见文字：${input.analysis.visibleText}`;
  await getDatabase().transaction(async (transaction) => {
    const [lastChunk] = await transaction
      .select({ ordinal: chunks.ordinal })
      .from(chunks)
      .where(eq(chunks.fileVersionId, input.fileVersionId))
      .orderBy(desc(chunks.ordinal))
      .limit(1);
    await transaction
      .update(visualAssets)
      .set({
        status: "completed",
        analysis: input.analysis,
        completedAt: new Date(),
      })
      .where(eq(visualAssets.id, input.assetId));
    await transaction.insert(chunks).values({
      id: randomUUID(),
      fileVersionId: input.fileVersionId,
      snapshotId: input.snapshotId,
      ordinal: (lastChunk?.ordinal ?? -1) + 1,
      content,
      contentHash: createHash("sha256").update(content).digest("hex"),
      startLine: null,
      endLine: null,
      sourceLocator: input.chunkLocator(input.assetId),
    });
  });
}

/** 读取 PNG/JPEG 的像素尺寸；不支持或损坏的图像在模型调用前明确拒绝。 */
function readImageDimensions(
  image: Uint8Array,
  mediaType: SupportedVisualMediaType,
) {
  if (mediaType === "image/png") return readPngDimensions(image);
  return readJpegDimensions(image);
}

/** PNG 的 IHDR 固定从第 16 字节开始保存宽高。 */
function readPngDimensions(image: Uint8Array) {
  if (image.length < 24 || String.fromCharCode(...image.slice(1, 4)) !== "PNG")
    throw new Error("Derived PNG is invalid.");
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** 扫描 JPEG 的 SOF 段读取宽高，避免为元数据引入第二个图片库。 */
function readJpegDimensions(image: Uint8Array) {
  if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8)
    throw new Error("Derived JPEG is invalid.");
  for (let offset = 2; offset + 9 < image.length; ) {
    if (image[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = image[offset + 1];
    const length = (image[offset + 2] << 8) + image[offset + 3];
    if (length < 2 || offset + 2 + length > image.length) break;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return {
        height: (image[offset + 5] << 8) + image[offset + 6],
        width: (image[offset + 7] << 8) + image[offset + 8],
      };
    }
    offset += length + 2;
  }
  throw new Error("JPEG dimensions cannot be read.");
}
