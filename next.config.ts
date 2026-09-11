/**
 * 修改时间：2026-09-11 | 文件说明：VaultAgent Next.js 与 Workflow 编译配置 | edit by：Sliye
 */

import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

/** VaultAgent 的基础 Next.js 配置，由 Workflow 包装器扩展构建能力。 */
const nextConfig: NextConfig = {
  /**
   * PDF.js 在 Node.js 中读取字体与 PDF 字节流；保持原生模块加载，避免 Turbopack 改写其服务端运行环境。
   * 官方文档：https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages
   */
  serverExternalPackages: ["pdfjs-dist"],
};

// https://useworkflow.dev/docs/frameworks/nextjs
export default withWorkflow(nextConfig);
