/**
 * 修改时间：2026-09-12
 * 文件说明：VaultAgent 支持格式与导入职责声明。
 *
 * 文件扩展名只在安全上传边界映射为 MIME 与职责；Workflow 和解析器只使用
 * 这里导出的可索引 MIME 集合，避免多个模块各自维护格式白名单。
 *
 * edit by：Sliye
 */

import path from "node:path";
import { ImportValidationError } from "@/lib/ingestion/errors";

//文件职责类型，index表示该文件会参与只是库得索引（现在暂时txt，md），attachment表示该文件仅作为附件存储，不参与索引（pdf，png，jpg，docx，xlsx，未来扩展）
export type ImportFileKind = "index" | "attachment";

/**
 * 文件格式描述对象，每种文件需要两个信息
 * mediaType: 文件的MIME类型
 * kind: 文件的导入职责类型
 */
export type ImportFileType = {
  mediaType: string;
  kind: ImportFileKind;
};

/** 当前已注册解析器的 MIME 类型，供批次查询与发布状态共用。 */
export const INDEXABLE_MEDIA_TYPES = [
  "text/markdown",
  "text/plain",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

const FILE_TYPES: Record<string, ImportFileType> = {
  ".md": { mediaType: "text/markdown", kind: "index" },
  ".txt": { mediaType: "text/plain", kind: "index" },
  ".png": { mediaType: "image/png", kind: "attachment" },
  ".jpg": { mediaType: "image/jpeg", kind: "attachment" },
  ".jpeg": { mediaType: "image/jpeg", kind: "attachment" },
  /** PDF 文本层由 D5 解析器按物理页建立索引。 */
  ".pdf": { mediaType: "application/pdf", kind: "index" },
  /** 使用 Mammoth 读取常规正文/表格，并受限分析内嵌 PNG/JPEG。 */
  ".docx": {
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "index",
  },
  ".xlsx": {
    mediaType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    /** D7 起读取基础工作表、单元格、公式缓存值与内嵌 PNG/JPEG。 */
    kind: "index",
  },
};

/** 返回路径的小写扩展名，供 ZIP 容器和直接上传入口共用
 * @param relativePath 浏览器上传的相对路径，或 ZIP 条目名
 * @returns 小写扩展名（含前导点），或空字符串
 */
export function getFileExtension(relativePath: string) {
  //path.posix.extname() 会返回路径的扩展名，包括前导点（例如 ".txt"） 如果没有扩展名则返回空字符串
  return path.posix.extname(relativePath).toLowerCase();
}

/** 判断上传项是否为 ZIP 容器；ZIP 不属于可解析文档格式。 */
export function isZipContainer(relativePath: string) {
  return getFileExtension(relativePath) === ".zip";
}

/** 返回文件的当前导入职责，未知格式必须明确拒绝。 */
export function getImportFileType(relativePath: string): ImportFileType {
  const extension = getFileExtension(relativePath);
  const fileType = FILE_TYPES[extension];
  if (!fileType) {
    throw new ImportValidationError(
      `暂不支持导入 ${extension || "无扩展名"} 文件。`,
    );
  }
  return fileType;
}

/** 判断文件版本是否应进入已注册的解析与向量化工作流。 */
export function isIndexableMediaType(mediaType: string) {
  return INDEXABLE_MEDIA_TYPES.some((type) => type === mediaType);
}
