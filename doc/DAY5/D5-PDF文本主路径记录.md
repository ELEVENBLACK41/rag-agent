<!-- 修改时间：2026-09-11 | 文件说明：VaultAgent DAY5 第一阶段 PDF 文本主路径实施与验收记录 | edit by：Sliye -->

# DAY5 第一阶段：PDF 文本主路径记录

状态：已完成。本阶段只实现文本 PDF 的导入、按物理页索引与页码引用；受限页面视觉分析按已调整计划保留在 DAY5 第二阶段，不把无文本页描述为已理解内容。

## 已完成实现

- 新增 `pdfjs-dist@6.3.289`，使用 PDF.js 文本层 API 读取 PDF；每个 Chunk 绝不跨物理页。
- `SourceLocator` 收口为 Markdown/TXT 行号定位与 PDF 页码定位两类联合类型；PDF Chunk 的 `start_line`、`end_line` 为 `NULL`，不伪造行号。
- 新增 `import_diagnostics`，存储解析警告的文件归属、阶段、页码与用户可见说明。Workflow 重试会先替换旧诊断，避免重复警告。
- PDF 无文本页会记录“尚未进行视觉分析”的页级警告；部分页面失败但其他页面可解析时，仍索引已成功页面。
- 导入工作流改为根据格式注册表处理可索引文件，不再把 Markdown/TXT MIME 列表写死在 Workflow 或快照发布逻辑中。
- 单个文件解析失败会保留该文件的真实失败信息；批次继续遵守“任一必需文件失败则不发布候选快照”的 D4 原子发布规则。
- 聊天检索与引用展示根据定位类型显示“第 N 页”或“第 X-Y 行”；导入面板显示 PDF 已发布状态及页级警告。
- 导入 API 从 `/api/imports/markdown` 收口为 `/api/imports`，避免 PDF 已接入后仍保留 Markdown 专用命名。

## 数据库迁移

- `0004_shiny_vector.sql`：创建 `import_diagnostics`；允许 `chunks.start_line`、`chunks.end_line` 为空。
- 已在本地 PostgreSQL 成功执行 `pnpm db:migrate`。

## 验证

| 检查项 | 结果 |
| --- | --- |
| PDF fixture 视觉核对 | 通过：第 1 页为清晰文本页，第 2 页仅含图形、没有文本层 |
| PDF.js 文本提取 | 通过：第 1 页提取 fixture 正文；第 2 页返回页级“无可提取文本层”诊断 |
| Drizzle 迁移生成与应用 | 通过：`pnpm db:generate`、`pnpm db:migrate` |
| TypeScript | 通过：`pnpm exec tsc --noEmit` |
| 生产构建 | 通过：`pnpm build`，识别 `/api/imports` 路由与 12 个 Workflow Step |
| ESLint | 无错误；保留两条既有生成文件/AI Elements 警告 |

## 当前限制

- 本阶段只读取 PDF 文本层；扫描件、图表、复杂排版和空文本页不会自动 OCR 或视觉理解。
- 尚未调用 Gateway 进行完整导入后向量化与聊天端到端验证，以避免在本次结构验证中产生不必要的模型费用；PDF.js 解析、数据库迁移、类型检查和生产构建均已真实验证。
- PDF 页面渲染、视觉模型调用、图片派生产物、额度控制和视觉结果检索留给 DAY5 第二阶段，并将与 PNG/JPEG、DOCX/XLSX 内嵌图片复用同一领域能力。
