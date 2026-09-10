/**
 * 修改时间：2026-09-10 | 文件说明：VaultAgent 各格式解析器共享输出类型 | edit by：Sliye
 */

/** 统一的原文定位结构；不同格式通过 format 和专属字段表达位置。 */
export type SourceLocator = {
  format: "markdown" | "plain-text";
  headingPath: string[];
  blockIds: string[];
  links: string[];
  attachments: string[];
};

/** 任何可索引格式都输出同一类文本块，后续检索层无需了解来源格式。 */
export type ParsedTextChunk = {
  content: string;
  startLine: number;
  endLine: number;
  sourceLocator: SourceLocator;
};
