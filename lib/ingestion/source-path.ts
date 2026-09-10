/**
 * 修改时间：2026-09-10 | 文件说明：VaultAgent Vault 相对路径校验 | edit by：Sliye
 */

import { ImportValidationError } from "@/lib/ingestion/errors";

/**
 * 标准化 Vault 内相对路径，拒绝 ZIP Slip、绝对路径和平台路径歧义。
 *
 * @param value 浏览器或 ZIP Entry 提供的文件路径。
 */
export function normalizeVaultPath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.split("/").some((part) => part === ".." || !part)
  ) {
    throw new ImportValidationError("文件路径必须是 Vault 内的有效相对路径。");
  }
  return normalized;
}
