/** 修改时间：2026-09-17 | 文件说明：VaultAgent 演示环境的导入与聊天访问门禁 | edit by：Sliye */

/**
 * 当前项目按用户决定作为单知识库演示站发布，本地、Preview 与 Production
 * 均可使用导入、聊天和来源接口。管理端仍由 Owner GitHub 登录单独保护。
 * 演示环境不提供多访客数据隔离，禁止上传私人资料。
 *
 * @param request 浏览器或验证脚本发出的请求。
 */
export function canAccessD3LocalFeature(request: Request) {
  void request;
  return true;
}
