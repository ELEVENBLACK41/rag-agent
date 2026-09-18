/**
 * 修改时间：2026-09-13
 * 文件说明：VaultAgent DOCX 内嵌图片候选提取与受限视觉分析编排。
 *
 * 本模块只理解 Word 容器中的图片顺序、格式和数量，不持有模型调用或数据库
 * 事务细节。每张成功图片都以 document-image 序号定位，失败不阻断 DOCX 正文
 * 和基础表格的索引发布。
 *
 * edit by：Sliye
 */

import mammoth from "mammoth";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { fileVersions, imports, visualAssets } from "@/lib/db/schema";
import { getErrorMessage } from "@/lib/ingestion/errors";
import { createVisualSourceKey } from "@/lib/ingestion/visual/types";
import {
  MAX_VISUAL_ASSETS_PER_IMPORT_BATCH,
  MAX_VISUAL_CANDIDATES_PER_FILE,
  MIN_VISUAL_IMAGE_EDGE_PIXELS,
  MAX_VISUAL_IMAGE_PIXELS,
} from "@/lib/ingestion/visual/limits";
import { analyzeAndStoreImage } from "@/lib/ingestion/visual/stored-image-analysis";
import { readStoredFile } from "@/lib/storage/files";

/**
 * 提取 DOCX 前几个 PNG/JPEG 内嵌图片，并为尚未处理的图片建立视觉结果。
 *
 * @param importId DOCX 导入记录标识。
 */
export async function analyzeDocxVisualImages(importId: string) {
  const importRecord = await getDocxImport(importId);
  if (!importRecord) return 0;
  const existingSourceKeys = await getExistingSourceKeys(importRecord.fileVersionId);
  const availableCount = await getAvailableBatchAssetCount(importRecord.batchId);
  if (!availableCount) return 0;

  const images = await extractDocxImages(
    await readStoredFile(importRecord.storageKey),
  );
  let completedCount = 0;
  for (const image of images) {
    const sourceLocator = { kind: "document-image" as const, imageIndex: image.index };
    const sourceKey = createVisualSourceKey(sourceLocator);
    if (existingSourceKeys.has(sourceKey) || completedCount >= availableCount)
      continue;
    if (
      image.width < MIN_VISUAL_IMAGE_EDGE_PIXELS ||
      image.height < MIN_VISUAL_IMAGE_EDGE_PIXELS ||
      image.width * image.height > MAX_VISUAL_IMAGE_PIXELS
    ) {
      console.warn("[ingestion:visual] DOCX image is outside visual size limits", {
        importId,
        imageIndex: image.index,
        width: image.width,
        height: image.height,
      });
      continue;
    }
    try {
      await analyzeAndStoreImage({
        importId,
        fileVersionId: importRecord.fileVersionId,
        snapshotId: importRecord.snapshotId,
        workspaceId: importRecord.workspaceId,
        sourceLocator,
        sourceKey,
        image: image.bytes,
        mediaType: image.mediaType,
        chunkLabel: `【视觉分析·DOCX 内嵌图片 ${image.index}】`,
        chunkLocator: (visualAssetId) => ({
          format: "docx-visual",
          imageIndex: image.index,
          visualAssetId,
        }),
      });
      completedCount += 1;
    } catch (error) {
      console.error("[ingestion:visual] DOCX image analysis failed", {
        importId,
        imageIndex: image.index,
        error: getErrorMessage(error, "Unknown DOCX image analysis error."),
      });
    }
  }
  return completedCount;
}

/** 查询并验证当前导入确实是已注册的 DOCX。 */
async function getDocxImport(importId: string) {
  const [record] = await getDatabase()
    .select({
      batchId: imports.batchId,
      fileVersionId: imports.fileVersionId,
      snapshotId: imports.snapshotId,
      workspaceId: imports.workspaceId,
      storageKey: fileVersions.storageKey,
      mediaType: fileVersions.mediaType,
    })
    .from(imports)
    .innerJoin(fileVersions, eq(imports.fileVersionId, fileVersions.id))
    .where(eq(imports.id, importId))
    .limit(1);
  return record?.mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ? record
    : null;
}

/** 从同一文件版本读取已持久化来源键，使 Workflow 重放不会重复调用模型。 */
async function getExistingSourceKeys(fileVersionId: string) {
  const records = await getDatabase()
    .select({ sourceKey: visualAssets.sourceKey })
    .from(visualAssets)
    .where(eq(visualAssets.fileVersionId, fileVersionId));
  return new Set(records.map((record) => record.sourceKey));
}

/** 所有格式共享批次视觉资产预算，避免混合文件绕过模型费用限制。 */
async function getAvailableBatchAssetCount(batchId: string | null) {
  if (!batchId) return MAX_VISUAL_CANDIDATES_PER_FILE;
  const batchAssets = await getDatabase()
    .select({ id: visualAssets.id })
    .from(visualAssets)
    .innerJoin(imports, eq(visualAssets.importId, imports.id))
    .where(eq(imports.batchId, batchId));
  return Math.max(0, Math.min(
    MAX_VISUAL_CANDIDATES_PER_FILE,
    MAX_VISUAL_ASSETS_PER_IMPORT_BATCH - batchAssets.length,
  ));
}

/** Mammoth 按文档出现顺序回调内嵌图片，过滤当前明确支持的 PNG/JPEG。 */
async function extractDocxImages(bytes: Uint8Array) {
  const images: Array<{
    index: number;
    bytes: Uint8Array;
    mediaType: "image/png" | "image/jpeg";
    width: number;
    height: number;
  }> = [];
  let imageIndex = 0;
  try {
    await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes) },
      {
        externalFileAccess: false,
        convertImage: mammoth.images.imgElement(async (image) => {
          imageIndex += 1;
          if (image.contentType !== "image/png" && image.contentType !== "image/jpeg")
            return { src: "" };
          const imageBytes = new Uint8Array(await image.readAsBuffer());
          const dimensions = readImageDimensions(imageBytes, image.contentType);
          images.push({
            index: imageIndex,
            bytes: imageBytes,
            mediaType: image.contentType,
            ...dimensions,
          });
          return { src: "" };
        }),
      },
    );
  } catch {
    throw new Error("DOCX 内嵌图片无法读取。");
  }
  return images.slice(0, MAX_VISUAL_CANDIDATES_PER_FILE);
}

/** 读取 PNG/JPEG 像素尺寸以执行导入侧视觉预算，格式校验仍在存储层再次执行。 */
function readImageDimensions(
  image: Uint8Array,
  mediaType: "image/png" | "image/jpeg",
) {
  if (mediaType === "image/png") {
    if (image.length < 24) throw new Error("DOCX embedded PNG is invalid.");
    const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
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
  throw new Error("DOCX embedded JPEG dimensions cannot be read.");
}
