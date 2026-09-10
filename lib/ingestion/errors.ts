/**
 * 修改时间：2026-09-10 | 文件说明：VaultAgent 导入输入校验错误类型 | edit by：Sliye
 */

/** 由不可信上传内容触发的可预期错误，路由据此返回 4xx。 */
export class ImportValidationError extends Error {}
