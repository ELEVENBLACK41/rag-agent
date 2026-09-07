/**
 * 修改时间：2026-09-07 | 文件说明：VaultAgent D3 Preview 导入验证访问保护 | edit by：Sliye
 */

import { timingSafeEqual } from "node:crypto";

/**
 * 判断请求是否可以使用 D3 的本地 Markdown 导入与运行记录接口。
 * Preview 环境只用于 D1 闭环验证，必须携带服务端保存的短期验证令牌。
 *
 * @param request 浏览器或验证脚本发出的请求。
 */
export function canAccessD3LocalFeature(request: Request) {
  const appMode = process.env.APP_MODE ?? "local";
  if (appMode === "local") return true;
  if (appMode !== "preview") return false;

  const expectedToken = process.env.PREVIEW_UPLOAD_TOKEN;
  const providedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expectedToken || !providedToken) return false;

  const expectedBuffer = Buffer.from(expectedToken);
  const providedBuffer = Buffer.from(providedToken);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}
