/**
 * 修改时间：2026-09-07 | 文件说明：VaultAgent D3 本地与 Preview 导入访问保护 | edit by：Sliye
 */

/**
 * 判断请求是否可以使用 D3 的上传、聊天与运行记录接口。
 * 本地开发和受 Vercel Deployment Protection 保护的 Preview 可直接使用；
 * Production 必须等待正式 Owner/Visitor 认证与配额门禁完成后才开放。
 *
 * @param request 浏览器或验证脚本发出的请求。
 */
export function canAccessD3LocalFeature(request: Request) {
  void request;

  const appMode = process.env.APP_MODE?.trim().toLowerCase();
  if (process.env.VERCEL_ENV === "production") return false;
  if (appMode === "local") return true;
  return appMode === "preview" || process.env.VERCEL_ENV === "preview";
}
