/**
 * 修改时间：2026-09-10 | 文件说明：VaultAgent ZIP 容器安全读取与文件名解码 | edit by：Sliye
 */

import * as yauzl from "yauzl";
import { ImportValidationError } from "@/lib/ingestion/errors";
import { isZipContainer } from "@/lib/ingestion/formats/file-types";
import { normalizeVaultPath } from "@/lib/ingestion/source-path";

/** ZIP 解压后最多包含的文件数。 */
const MAX_ZIP_ENTRY_COUNT = 50;
/** ZIP 解压后允许的总大小，单位：字节。 */
const MAX_ZIP_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

export type ZipEntryFile = {
  relativePath: string;
  bytes: Uint8Array;
};

/**
 * 只读取 ZIP 容器中的安全文件条目。格式识别、存储和索引由上层处理。
 *
 * @param bytes 浏览器上传的 ZIP 原始字节。
 */
export async function readZipEntries(
  bytes: Uint8Array,
): Promise<ZipEntryFile[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      Buffer.from(bytes),
      { lazyEntries: true, decodeStrings: false, validateEntrySizes: true },
      (openError, archive) => {
        if (openError || !archive)
          return reject(new ImportValidationError("无法读取 ZIP 压缩包。"));
        const files: ZipEntryFile[] = [];
        let uncompressedBytes = 0;
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          archive.close();
          reject(error);
        };

        archive.on("error", () =>
          fail(new ImportValidationError("ZIP 压缩包已损坏。")),
        );
        archive.on("entry", (entry) => {
          try {
            const fileName = decodeZipFileName(
              entry.fileName as unknown as Buffer,
              entry.generalPurposeBitFlag,
              entry.extraFields,
            );
            if (fileName.endsWith("/")) return archive.readEntry();
            if (entry.generalPurposeBitFlag & 0x1)
              return fail(new ImportValidationError("不支持加密 ZIP。"));
            const unixFileType =
              (entry.externalFileAttributes >>> 16) & 0o170000;
            if (unixFileType === 0o120000)
              return fail(
                new ImportValidationError("不支持 ZIP 内的符号链接。"),
              );
            const relativePath = normalizeVaultPath(fileName);
            if (isZipContainer(relativePath))
              return fail(new ImportValidationError("不支持嵌套 ZIP。"));
            uncompressedBytes += entry.uncompressedSize;
            if (
              files.length >= MAX_ZIP_ENTRY_COUNT ||
              uncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES
            ) {
              return fail(
                new ImportValidationError(
                  "ZIP 解压后的文件数量或总大小超出限制。",
                ),
              );
            }
            archive.openReadStream(entry, (streamError, stream) => {
              if (streamError || !stream)
                return fail(new ImportValidationError("无法读取 ZIP 内文件。"));
              const chunks: Buffer[] = [];
              stream.on("data", (chunk: Buffer) => chunks.push(chunk));
              stream.on("error", () =>
                fail(new ImportValidationError("ZIP 内文件读取失败。")),
              );
              stream.on("end", () => {
                if (settled) return;
                const content = Buffer.concat(chunks);
                if (content.byteLength !== entry.uncompressedSize)
                  return fail(
                    new ImportValidationError("ZIP 内文件大小校验失败。"),
                  );
                files.push({ relativePath, bytes: new Uint8Array(content) });
                archive.readEntry();
              });
            });
          } catch (error) {
            fail(
              error instanceof Error
                ? error
                : new ImportValidationError("ZIP 校验失败。"),
            );
          }
        });
        archive.on("end", () => {
          if (settled) return;
          settled = true;
          resolve(files);
        });
        archive.readEntry();
      },
    );
  });
}

/** 解码 ZIP 原始文件名，兼容 UTF-8、Info-ZIP Unicode Path 和 Windows GB18030。 */
function decodeZipFileName(
  rawFileName: Buffer,
  generalPurposeBitFlag: number,
  extraFields: Array<{ id: number; data: Buffer }>,
) {
  const unicodePath = extraFields.find((field) => field.id === 0x7075)?.data;
  if (unicodePath && unicodePath.byteLength > 5)
    return decodeText(
      unicodePath.subarray(5),
      "utf-8",
      "ZIP Unicode 文件名无效。",
    );
  if (generalPurposeBitFlag & 0x800)
    return decodeText(rawFileName, "utf-8", "ZIP UTF-8 文件名无效。");
  if (rawFileName.every((byte) => byte < 0x80))
    return rawFileName.toString("utf8");
  try {
    return decodeText(rawFileName, "utf-8", "");
  } catch {
    return decodeText(rawFileName, "gb18030", "ZIP 中文文件名无法解码。");
  }
}

/** 严格解码，拒绝无效字节，防止文件名静默变成乱码。 */
function decodeText(bytes: Uint8Array, encoding: string, message: string) {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new ImportValidationError(message || "ZIP UTF-8 文件名无效。");
  }
}
