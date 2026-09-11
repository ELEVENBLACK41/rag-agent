<!-- 修改时间：2026-09-11 | 文件说明：VaultAgent DAY5 第二阶段 PDF 自动视觉分析实施与验收记录 | edit by：Sliye -->

# DAY5 第二阶段：PDF 自动视觉分析记录

状态：代码与本地数据库迁移已完成；PDF 页面渲染已真实验证。Gateway 视觉调用受当前受限执行环境的外网策略阻断，需在正常开发网络下随下一次 PDF 导入完成最终联调。

## 实现范围

- 用户始终上传整份 PDF；文本层继续全量解析、全量建立页码索引。
- 不提供手动选页。系统只自动候选 `no-text-layer` 的页面，每份 PDF 最多 2 页、每批最多 5 页。
- 候选页使用 PDF.js 与 `@napi-rs/canvas` 渲染 PNG，像素总量限制为 2,000,000，最长边限制为 2,048。
- 渲染图作为私有派生资产保存到统一 Storage；`visual_assets` 保存其父导入、文件版本、物理页、哈希、尺寸、模型版本、提示词版本、状态、分析结果和错误。
- Qwen 3.7 Flash 接收 PNG 文件 part，返回描述、可见文字和置信度的结构化结果。视觉结果追加为 `pdf-visual` Chunk，仍绑定父 PDF 的物理页并和文本 Chunk 一起向量化。
- 单页视觉分析失败只标记该资产失败，文本 PDF 导入和候选快照发布继续完成。
- 导入面板显示候选页的视觉分析状态。

## 迁移与依赖

- 新增直接依赖：`@napi-rs/canvas@1.0.9`，为 PDF.js Node 页面渲染提供 Canvas。
- 新增迁移：`0005_narrow_true_believers.sql`。
  - 创建 `visual_assets`。
  - 为 `import_diagnostics` 增加稳定的诊断 code，区分无文本页与文本提取失败。
- Next.js 服务端外置 `pdfjs-dist` 和 `@napi-rs/canvas`，避免 Turbopack 改写 Node 原生运行时。

## 验证

| 检查项 | 结果 |
| --- | --- |
| PDF.js + Canvas 渲染 | 通过：无文本 fixture 第 2 页成功渲染为 596 × 842 的 PNG |
| 图表与表格 fixture | 通过：`vaultagent-visual-table-fixture.pdf` 第 1 页原生文本表格可提取 300 个字符；第 2 页嵌入 PNG 架构图没有 PDF 文本层，会成为自动视觉候选 |
| 数据库迁移 | 通过：`pnpm db:migrate` 已应用 `0005` |
| TypeScript | 通过：`pnpm exec tsc --noEmit` |
| ESLint | 无错误；保留两个既有警告 |
| Gateway 视觉调用 | 当前环境被 `EACCES` 阻断访问 `ai-gateway.vercel.sh:443`；非鉴权或业务代码错误 |

## 首次联调更正

首次上传 fixture 时，`parsePdf()` 已正确产生 `no-text-layer`，但 `replaceImportDiagnostics()` 漏写了诊断 code 列，数据库默认值将其写成 `text-extraction-failed`。视觉候选查询因此找不到该页，`visual_assets` 没有创建。

已修复：持久化诊断时写入 `diagnostic.code`。重新上传 fixture 后，第 2 页会进入自动视觉候选；旧导入记录不会自动回放 Workflow。

## 待联调

1. 完全重启 `pnpm dev`，让 Native Canvas 外置配置生效。
2. 导入含无文本页的 PDF fixture 或扫描件。
3. 验证导入面板显示该页视觉分析状态，`visual_assets` 写入 PNG 与结构化结果，视觉 Chunk 参与后续检索。
4. Gateway 不可用时确认该页状态为失败、错误可见，但 PDF 文本索引和整批快照不被阻断。
