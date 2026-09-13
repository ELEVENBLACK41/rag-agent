/**
 * 修改时间：2026-09-13
 * 文件说明：VaultAgent 基础 XLSX 工作表、单元格与公式缓存值解析器。
 *
 * ExcelJS 只负责读取 Office Open XML；本模块将非空单元格按工作表区域收敛为
 * 检索 Chunk，并保留公式与文件内缓存值的区别。图片提取停留在 visual 模块，
 * 不让解析器承担模型调用、存储或 Workflow 编排职责。
 *
 * ExcelJS 文档：https://github.com/exceljs/exceljs#formula-value
 *
 * edit by：Sliye
 */

import * as yauzl from "yauzl";
import ExcelJS, { type CellValue, type Workbook } from "exceljs";
import { ImportValidationError } from "@/lib/ingestion/errors";
import type { ParsedDocument, ParsedTextChunk } from "@/lib/ingestion/formats/types";

/** 单个 XLSX 检索块最大字符数，与其他结构化文档保持一致。 */
const MAX_CHUNK_CHARACTERS = 1_400;
/** 一个工作簿允许的最多工作表数，防止小文件在解压后制造大量解析任务。 */
const MAX_WORKSHEET_COUNT = 50;
/** 单个工作表可读取的最多非空单元格数，避免稀疏表格绕过行数限制。 */
const MAX_NON_EMPTY_CELLS_PER_WORKSHEET = 10_000;
/** XLSX 容器最多条目数，覆盖常规 Office 元数据、工作表与图片。 */
const MAX_XLSX_ARCHIVE_ENTRY_COUNT = 1_000;
/** XLSX 解压后的总大小上限，防止压缩炸弹进入 ExcelJS。 */
const MAX_XLSX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

/**
 * 解析基础 XLSX 的工作表、非空单元格、公式与缓存值。
 * ExcelJS 不计算公式，因此缓存值只代表文件保存时的结果，缺失时会明确保留。
 *
 * @param bytes 已安全保存的 XLSX 原始字节。
 */
export async function parseXlsx(bytes: Uint8Array): Promise<ParsedDocument> {
  const workbook = await loadXlsxWorkbook(bytes);
  if (workbook.worksheets.length > MAX_WORKSHEET_COUNT) {
    throw new ImportValidationError(
      `XLSX 工作表数量超过 ${MAX_WORKSHEET_COUNT} 个上限。`,
    );
  }

  const chunks = workbook.worksheets.flatMap((worksheet) =>
    parseWorksheet(worksheet),
  );
  return { chunks, diagnostics: [] };
}

/**
 * 在交给 ExcelJS 解压前验证 XLSX ZIP 容器，再加载完整工作簿。
 * 图片分析模块复用本函数，确保两条读取路径采用同一资源边界。
 *
 * @param bytes XLSX 文件原始字节。
 */
export async function loadXlsxWorkbook(bytes: Uint8Array): Promise<Workbook> {
  await validateXlsxArchive(bytes);
  const workbook = new ExcelJS.Workbook();
  try {
    const workbookBytes = Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    /** ExcelJS 4.4 的旧 Buffer 声明与当前 Node 泛型 Buffer 不兼容，运行时二者均为 Node Buffer。 */
    await workbook.xlsx.load(
      workbookBytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new ImportValidationError(
      "XLSX 无法解析。请确认文件未损坏、未加密且为常规 Excel 工作簿。",
    );
  }
  return workbook;
}

/** 将同一工作表的非空单元格按相邻内容收敛为可定位的检索 Chunk。 */
function parseWorksheet(worksheet: ExcelJS.Worksheet): ParsedTextChunk[] {
  const chunks: ParsedTextChunk[] = [];
  let nonEmptyCellCount = 0;
  let pendingContent = "";
  let firstAddress: string | null = null;
  let lastAddress: string | null = null;

  const flush = () => {
    if (!pendingContent || !firstAddress || !lastAddress) return;
    chunks.push({
      content: `工作表：${worksheet.name}\n${pendingContent}`,
      startLine: null,
      endLine: null,
      sourceLocator: {
        format: "xlsx",
        sheetName: worksheet.name,
        range: firstAddress === lastAddress
          ? firstAddress
          : `${firstAddress}:${lastAddress}`,
      },
    });
    pendingContent = "";
    firstAddress = null;
    lastAddress = null;
  };

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const rowParts: string[] = [];
    let rowFirstAddress: string | null = null;
    let rowLastAddress: string | null = null;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const content = formatCell(cell.value, cell.formula, cell.result);
      if (!content) return;
      nonEmptyCellCount += 1;
      if (nonEmptyCellCount > MAX_NON_EMPTY_CELLS_PER_WORKSHEET) {
        throw new ImportValidationError(
          `工作表“${worksheet.name}”超过 ${MAX_NON_EMPTY_CELLS_PER_WORKSHEET} 个非空单元格上限。`,
        );
      }
      rowFirstAddress ??= cell.address;
      rowLastAddress = cell.address;
      rowParts.push(`${cell.address}：${content}`);
    });
    if (!rowParts.length || !rowFirstAddress || !rowLastAddress) return;

    const rowContent = rowParts.join(" | ");
    if (
      pendingContent &&
      `工作表：${worksheet.name}\n${pendingContent}\n${rowContent}`.length >
        MAX_CHUNK_CHARACTERS
    ) {
      flush();
    }
    firstAddress ??= rowFirstAddress;
    lastAddress = rowLastAddress;
    pendingContent = pendingContent ? `${pendingContent}\n${rowContent}` : rowContent;
  });
  flush();
  return chunks;
}

/** 将 ExcelJS 单元格值表达为可检索文本，公式与缓存值始终分开标记。 */
function formatCell(
  value: CellValue,
  formula: string,
  result: unknown,
) {
  if (formula) {
    const cachedValue = formatCellValue(result);
    return `公式 = ${formula}；缓存值 = ${cachedValue || "未提供"}`;
  }
  return formatCellValue(value);
}

/** 保留基础值、富文本与超链接文本，拒绝未定义或空字符串。 */
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value !== "object") return "";
  if ("error" in value && typeof value.error === "string") return value.error;
  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
      .join("")
      .trim();
  }
  if ("text" in value && typeof value.text === "string") {
    return "hyperlink" in value && typeof value.hyperlink === "string"
      ? `${value.text}（${value.hyperlink}）`
      : value.text;
  }
  return "";
}

/** 只读取 XLSX ZIP 的目录信息，拒绝加密、非 XLSX 容器和异常解压规模。 */
async function validateXlsxArchive(bytes: Uint8Array) {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(
      Buffer.from(bytes),
      { lazyEntries: true, validateEntrySizes: true },
      (openError, archive) => {
        if (openError || !archive) {
          reject(new ImportValidationError("无法读取 XLSX 压缩容器。"));
          return;
        }
        let entryCount = 0;
        let uncompressedBytes = 0;
        let hasContentTypes = false;
        let hasWorkbook = false;
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          archive.close();
          reject(error);
        };

        archive.on("error", () =>
          fail(new ImportValidationError("XLSX 压缩容器已损坏。")),
        );
        archive.on("entry", (entry) => {
          if (entry.generalPurposeBitFlag & 0x1) {
            fail(new ImportValidationError("不支持加密 XLSX。"));
            return;
          }
          entryCount += 1;
          uncompressedBytes += entry.uncompressedSize;
          hasContentTypes ||= entry.fileName === "[Content_Types].xml";
          hasWorkbook ||= entry.fileName === "xl/workbook.xml";
          if (
            entryCount > MAX_XLSX_ARCHIVE_ENTRY_COUNT ||
            uncompressedBytes > MAX_XLSX_UNCOMPRESSED_BYTES
          ) {
            fail(new ImportValidationError("XLSX 解压后的文件数量或总大小超出限制。"));
            return;
          }
          archive.readEntry();
        });
        archive.on("end", () => {
          if (settled) return;
          settled = true;
          if (!hasContentTypes || !hasWorkbook) {
            reject(new ImportValidationError("文件不是有效的 XLSX 工作簿。"));
            return;
          }
          resolve();
        });
        archive.readEntry();
      },
    );
  });
}
