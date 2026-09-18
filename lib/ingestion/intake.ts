/**
 * 修改时间：2026-09-10 | 文件说明：VaultAgent 多文件导入入口与批次限额 | edit by：Sliye
 */

import { ImportValidationError } from "@/lib/ingestion/errors";
import {
  getImportFileType,
  isZipContainer,
} from "@/lib/ingestion/formats/file-types";
import type { VaultUploadFile } from "@/lib/ingestion/imports";
import { normalizeVaultPath } from "@/lib/ingestion/source-path";
import { readZipEntries } from "@/lib/ingestion/zip";

/** 单次导入允许的最多文件数量。 */
const MAX_IMPORT_FILE_COUNT = 50;
/** 浏览器提交的压缩前文件总大小上限，单位：字节。 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** 批次展开后的文件总大小上限，单位：字节。 */
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

/**
 * 将浏览器上传转换为受限 Vault 文件集。ZIP 仅负责展开，格式职责由 formats 模块声明。
 *
 * @param uploads 路由入口从 multipart/form-data 读取的文件与相对路径。
 */
export async function collectVaultUploadFiles(
  uploads: Array<{ file: File; relativePath: string }>,
): Promise<VaultUploadFile[]> {
  if (!uploads.length) throw new ImportValidationError("请至少选择一个文件。");
  if (uploads.length > MAX_IMPORT_FILE_COUNT)
    throw new ImportValidationError(
      `单次最多导入 ${MAX_IMPORT_FILE_COUNT} 个文件。`,
    );
  const uploadBytes = uploads.reduce(
    (sum, upload) => sum + upload.file.size,
    0,
  );
  if (!uploadBytes || uploadBytes > MAX_UPLOAD_BYTES)
    throw new ImportValidationError("单次上传总大小必须在 1 B 到 25 MB 之间。");

  const files: VaultUploadFile[] = [];
  for (const upload of uploads) {
    const relativePath = normalizeVaultPath(upload.relativePath);
    if (isZipContainer(relativePath)) {
      const entries = await readZipEntries(
        new Uint8Array(await upload.file.arrayBuffer()),
      );
      files.push(
        ...entries.map((entry) => ({
          ...entry,
          ...getImportFileType(entry.relativePath),
        })),
      );
      continue;
    }
    files.push({
      relativePath,
      bytes: new Uint8Array(await upload.file.arrayBuffer()),
      ...getImportFileType(relativePath),
    });
  }

  if (files.length > MAX_IMPORT_FILE_COUNT)
    throw new ImportValidationError(
      `解压后最多允许 ${MAX_IMPORT_FILE_COUNT} 个文件。`,
    );
  const uncompressedBytes = files.reduce(
    (sum, file) => sum + file.bytes.byteLength,
    0,
  );
  if (!uncompressedBytes || uncompressedBytes > MAX_UNCOMPRESSED_BYTES)
    throw new ImportValidationError(
      "解压后的文件总大小必须在 1 B 到 50 MB 之间。",
    );
  const paths = files.map((file) => file.relativePath);
  if (new Set(paths).size !== paths.length)
    throw new ImportValidationError("同一批次中不能包含相同的相对路径。");
  return files;
}
