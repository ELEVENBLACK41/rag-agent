/**
 * 修改时间：2026-09-13
 * 文件说明：VaultAgent XLSX 内嵌图片候选提取与受限视觉分析编排。
 *
 * 本模块只读取 ExcelJS 提供的工作表图片锚点与原始图片数据，统一视觉资产的
 * 存储、模型调用和检索 Chunk 仍交由 stored-image-analysis 处理。
 *
 * ExcelJS 图片文档：https://github.com/exceljs/exceljs#images
 *
 * edit by：Sliye
 */

import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { fileVersions, imports, visualAssets } from "@/lib/db/schema";
import { loadXlsxWorkbook } from "@/lib/ingestion/formats/xlsx";
import { getErrorMessage } from "@/lib/ingestion/errors";
import {
  MAX_VISUAL_ASSETS_PER_IMPORT_BATCH,
  MAX_VISUAL_CANDIDATES_PER_FILE,
  MIN_VISUAL_IMAGE_EDGE_PIXELS,
  MAX_VISUAL_IMAGE_PIXELS,
} from "@/lib/ingestion/visual/limits";
import { analyzeAndStoreImage } from "@/lib/ingestion/visual/stored-image-analysis";
import { createVisualSourceKey } from "@/lib/ingestion/visual/types";
import { readStoredFile } from "@/lib/storage/files";

/** XLSX MIME 类型仅在本格式编排模块中使用，避免散落在 Workflow 条件分支中。 */
const XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * 提取 XLSX 前几个 PNG/JPEG 内嵌图片，并建立可回溯到工作表锚点的视觉结果。
 * 单张图片失败或格式不支持都不影响 XLSX 的单元格文本索引与快照发布。
 *
 * @param importId XLSX 导入记录标识。
 */
export async function analyzeXlsxVisualImages(importId: string) {
  const importRecord = await getXlsxImport(importId);
  if (!importRecord) return 0;

  let images: Awaited<ReturnType<typeof extractXlsxImages>>;
  try {
    images = await extractXlsxImages(await readStoredFile(importRecord.storageKey));
  } catch (error) {
    console.error("[ingestion:visual] XLSX embedded images cannot be read", {
      importId,
      error: getErrorMessage(error, "Unknown XLSX image extraction error."),
    });
    return 0;
  }

  const existingSourceKeys = await getExistingSourceKeys(importRecord.fileVersionId);
  const availableCount = await getAvailableBatchAssetCount(importRecord.batchId);
  let completedCount = 0;
  for (const image of images) {
    if (completedCount >= availableCount) break;
    const sourceLocator = {
      kind: "worksheet-image" as const,
      sheetName: image.sheetName,
      anchor: image.anchor,
      imageIndex: image.index,
    };
    const sourceKey = createVisualSourceKey(sourceLocator);
    if (existingSourceKeys.has(sourceKey)) continue;
    if (
      image.width < MIN_VISUAL_IMAGE_EDGE_PIXELS ||
      image.height < MIN_VISUAL_IMAGE_EDGE_PIXELS ||
      image.width * image.height > MAX_VISUAL_IMAGE_PIXELS
    ) {
      console.warn("[ingestion:visual] XLSX image is outside visual size limits", {
        importId,
        sheetName: image.sheetName,
        anchor: image.anchor,
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
        chunkLabel: `【视觉分析·工作表 ${image.sheetName} · 内嵌图片 ${image.index}】`,
        chunkLocator: (visualAssetId) => ({
          format: "xlsx-visual",
          sheetName: image.sheetName,
          anchor: image.anchor,
          imageIndex: image.index,
          visualAssetId,
        }),
      });
      completedCount += 1;
    } catch (error) {
      console.error("[ingestion:visual] XLSX image analysis failed", {
        importId,
        sheetName: image.sheetName,
        anchor: image.anchor,
        error: getErrorMessage(error, "Unknown XLSX image analysis error."),
      });
    }
  }
  return completedCount;
}

/** 查询并验证当前导入确实是已注册的 XLSX。 */
async function getXlsxImport(importId: string) {
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
  return record?.mediaType === XLSX_MEDIA_TYPE ? record : null;
}

/** 从同一文件版本读取来源键，使 Workflow 重放不会重复调用模型。 */
async function getExistingSourceKeys(fileVersionId: string) {
  const records = await getDatabase()
    .select({ sourceKey: visualAssets.sourceKey })
    .from(visualAssets)
    .where(eq(visualAssets.fileVersionId, fileVersionId));
  return new Set(records.map((record) => record.sourceKey));
}

/** 所有格式共享批次视觉资产预算，混合 Office 文件也不能绕过限额。 */
async function getAvailableBatchAssetCount(batchId: string | null) {
  if (!batchId) return MAX_VISUAL_CANDIDATES_PER_FILE;
  const batchAssets = await getDatabase()
    .select({ id: visualAssets.id })
    .from(visualAssets)
    .innerJoin(imports, eq(visualAssets.importId, imports.id))
    .where(eq(imports.batchId, batchId));
  return Math.max(
    0,
    Math.min(
      MAX_VISUAL_CANDIDATES_PER_FILE,
      MAX_VISUAL_ASSETS_PER_IMPORT_BATCH - batchAssets.length,
    ),
  );
}

/** 使用 ExcelJS 的公共图片 API 读取 PNG/JPEG 及其工作表锚点。 */
async function extractXlsxImages(bytes: Uint8Array) {
  const workbook = await loadXlsxWorkbook(bytes);
  const images: Array<{
    index: number;
    sheetName: string;
    anchor: string;
    bytes: Uint8Array;
    mediaType: "image/png" | "image/jpeg";
    width: number;
    height: number;
  }> = [];
  let imageIndex = 0;
  for (const worksheet of workbook.worksheets) {
    for (const imageReference of worksheet.getImages()) {
      imageIndex += 1;
      if (images.length >= MAX_VISUAL_CANDIDATES_PER_FILE) return images;
      const imageId = Number(imageReference.imageId);
      if (!Number.isInteger(imageId)) continue;
      const image = workbook.getImage(imageId);
      if (!image.buffer || (image.extension !== "png" && image.extension !== "jpeg"))
        continue;
      const imageBytes = new Uint8Array(image.buffer);
      const dimensions = readImageDimensions(
        imageBytes,
        image.extension === "png" ? "image/png" : "image/jpeg",
      );
      images.push({
        index: imageIndex,
        sheetName: worksheet.name,
        anchor: worksheet.getCell(
          imageReference.range.tl.nativeRow + 1,
          imageReference.range.tl.nativeCol + 1,
        ).address,
        bytes: imageBytes,
        mediaType: image.extension === "png" ? "image/png" : "image/jpeg",
        ...dimensions,
      });
    }
  }
  return images;
}

/** 读取 PNG/JPEG 像素尺寸，以便模型调用前执行文件级预算。 */
function readImageDimensions(
  image: Uint8Array,
  mediaType: "image/png" | "image/jpeg",
) {
  if (mediaType === "image/png") {
    if (image.length < 24) throw new Error("XLSX embedded PNG is invalid.");
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
  throw new Error("XLSX embedded JPEG dimensions cannot be read.");
}
