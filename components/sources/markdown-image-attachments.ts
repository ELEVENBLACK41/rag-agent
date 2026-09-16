/** 修改时间：2026-09-16 | 文件说明：在 Markdown 安全过滤前将本地图片转换为受权附件地址 | edit by：Sliye */
import { defaultRehypePlugins, defaultUrlTransform, type StreamdownProps, type UrlTransform } from "streamdown";

/** 只读取 HTML 树中的图片地址，不修改文本、链接与代码。 */
type ImageTreeNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: ImageTreeNode[];
};

/**
 * @param attachmentUrl 当前 Run/Chunk 的受权附件接口。
 * 官方：https://streamdown.ai/docs/security；保留 raw、sanitize、harden，仅在 harden 前改写图片。
 */
export function createMarkdownImageAttachments(attachmentUrl: string) {
  /** 自定义插件数组需显式保留 Viewer 原有的 mark 白名单；allowedTags 仅扩展默认数组。 */
  const sanitize = defaultRehypePlugins.sanitize as [
    unknown,
    { tagNames: string[]; attributes: Record<string, unknown[]> },
  ];
  const sourceSanitize = [sanitize[0], {
    ...sanitize[1],
    tagNames: [...sanitize[1].tagNames, "mark"],
    attributes: { ...sanitize[1].attributes, mark: ["dataVaultagentColor"] },
  }] as typeof defaultRehypePlugins.sanitize;
  /** 地址来自 Markdown URL，解码一次后作为查询参数编码；服务端不再进行路径解码。 */
  function rewriteImages(node: ImageTreeNode) {
    if (node.tagName === "img" && node.properties) {
      const src = node.properties.src;
      let target: string | null = null;
      if (typeof src === "string") {
        try {
          target = decodeURIComponent(src);
        } catch {
          // 损坏的 URL 不发送附件请求。
        }
      }
      if (target && !target.startsWith("/") && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) {
        node.properties.src = `${attachmentUrl}?path=${encodeURIComponent(target)}`;
      } else {
        delete node.properties.src;
      }
    }
    node.children?.forEach(rewriteImages);
  }

  /** 相对文件名在默认 harden 中会被丢弃，因此先转换，再沿用完整安全过滤。 */
  const rehypePlugins: StreamdownProps["rehypePlugins"] = [
    defaultRehypePlugins.raw,
    sourceSanitize,
    () => rewriteImages,
    defaultRehypePlugins.harden,
  ];
  /** 只允许本组件构造的附件接口成为图片地址；远程图片不直接请求。 */
  const urlTransform: UrlTransform = (url, key, node) => {
    if (key !== "src") return defaultUrlTransform(url, key, node);
    return url.startsWith(`${attachmentUrl}?path=`) ? url : null;
  };
  return { rehypePlugins, urlTransform };
}
