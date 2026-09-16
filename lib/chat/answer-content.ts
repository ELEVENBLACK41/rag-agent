/**
 * 修改时间：2026-09-16
 * 文件说明：最终回答正文的可见内容门禁。
 *
 * 知识库图片必须由服务端验证后的 imageCitationIds 渲染。模型生成的 Markdown
 * 或 HTML 图片地址不具备来源授权，完成前统一移除。
 *
 * edit by：Sliye
 */

/** 删除模型生成的图片标记，同时保留其余 Markdown 正文。 */
export function removeUntrustedImageMarkup(answer: string) {
  return answer
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/!\[[^\]]*\]\((?:\\.|[^)])*\)/g, "")
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
