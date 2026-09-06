/**
 * 修改时间：2026-09-06 | 文件说明：VaultAgent Next.js 与 Workflow 编译配置 | edit by：Sliye
 */

import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

/** VaultAgent 的基础 Next.js 配置，由 Workflow 包装器扩展构建能力。 */
const nextConfig: NextConfig = {
};

// https://useworkflow.dev/docs/frameworks/nextjs
export default withWorkflow(nextConfig);
