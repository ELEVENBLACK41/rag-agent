/**
 * 修改时间：2026-09-11 | 文件说明：VaultAgent 导入错误类型与安全错误信息提取 | edit by：Sliye
 */

/** 由不可信上传内容触发的可预期错误，路由据此返回 4xx。 */
export class ImportValidationError extends Error {}

/**
 * 从普通 Error 或 Workflow 跨 Step 序列化后的对象读取错误信息。
 *
 * @param error 捕获到的未知异常。
 * @param fallback 无可用消息时写入业务状态的安全回退文本。
 */
export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }
  return fallback;
}
