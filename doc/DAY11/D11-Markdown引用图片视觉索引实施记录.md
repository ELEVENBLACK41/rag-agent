<!-- 修改时间：2026-09-16 | 文件说明：Markdown 引用图片导入时视觉索引、版本隔离与真实验证记录 | edit by：Sliye -->

# DAY11：Markdown 引用图片视觉索引

状态：已完成。Markdown 正文引用的 PNG/JPEG 已进入现有视觉分析、Embedding、混合检索、来源引用与原图预览链路；图片附件单独更新时会为继承的 Markdown 补建新版本视觉索引，历史 Run 不会串图。

## 实现范围

- Markdown 解析完成后，只选择正文真实引用的 PNG/JPEG；代码块中的示例图片语法不触发模型调用，未引用附件不自动分析。
- 导入期与来源预览共用同一套路径解析：优先笔记同目录、再 Vault 根目录，最后只接受全 Vault 唯一短文件名；拒绝协议、绝对路径和越界路径。
- 候选附件同时读取当前批次与上一已发布快照；同路径由当前批次新版本覆盖。每文件最多 2 张、每批最多 5 个视觉资产，并沿用最小边长和最大像素限制。
- 复用 Qwen 3.7 Flash 与统一视觉存储入口，保存模型、提示词版本、图片哈希、状态、描述、可见文字和置信度。成功结果生成 `markdown-visual` Chunk，并与普通文本块一起 Embedding。
- 视觉 Chunk 保存 Markdown 行号、附件路径和附件文件版本。混合检索和来源读取会再次校验该附件版本属于当前 Run 固定快照，不能把旧图描述带入新快照。
- 图片附件可以独立更新：Workflow 会扫描候选快照继承的 Markdown，只为当前批次新图片版本补建缺失视觉 Chunk，再补做 Embedding。旧 Run 继续读取旧图片版本和旧分析。
- 来源抽屉同时返回完整 Markdown、引用行高亮、视觉描述和受鉴权原图；浏览器不能通过存储键或文件版本 ID 直接读取图片。
- 单张图片缺失、路径歧义、尺寸超限或模型失败不阻断 Markdown 文本索引和批次发布；结构问题留给 D11 后续审计页面集中展示。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `lib/ingestion/markdown-attachment-path.ts` | 导入和预览共用的附件目标标准化与路径匹配 |
| `lib/ingestion/visual/markdown-image-records.ts` | 候选快照、导入记录与批次视觉预算查询 |
| `lib/ingestion/visual/markdown-image-references.ts` | Markdown 正文引用解析、路径匹配与按图片版本去重 |
| `lib/ingestion/visual/markdown-image-analysis.ts` | 图片更新补索引、尺寸门禁、模型调用与视觉 Chunk 编排 |
| `lib/ingestion/visual/stored-image-analysis.ts` | 跨格式图片保存、模型调用、视觉 Chunk 与置信度持久化 |
| `workflows/ingest-import-batch/*` | 当前文件视觉步骤、继承 Markdown 补分析与 Embedding 顺序 |
| `lib/retrieval/search.ts`、`lib/sources/reader.ts` | 按 Run 快照校验 Markdown 视觉 Chunk 的附件版本 |
| `components/sources/source-drawer.tsx` | 展示 Markdown 图片定位、视觉描述和原图 |

## 实际验证

- 使用临时 Markdown 与 256×128 PNG 完成真实上传；批次完成，视觉资产状态为 `completed`，`markdown-visual` Chunk 保存图片行号、附件路径、附件版本和 `high` 置信度。
- 真实问答经过 `search_notes → read_sources → finish_research`，正确回答图片文字、背景与色块内容；最终引用只包含实际读取的 Markdown 视觉来源。
- 来源 API 返回 Markdown 第 3 行高亮与视觉原图地址，受鉴权图片接口返回 `image/png`。
- 单独替换同一路径图片后，Workflow 为继承的 Markdown 自动生成新视觉 Chunk；当前 Run 读取到新文字和新颜色，旧 Run 仍返回旧图片描述，验证快照隔离有效。
- 删除图片附件后，旧视觉来源立即通过附件版本状态与逻辑删除门禁返回 404，不再通过 Markdown 派生图片地址继续读取。
- 所有临时会话、文件版本与当前快照可见性已通过产品删除接口清理，知识库中无测试路径残留。
- 完整 TypeScript 检查、全量 ESLint 和 `git diff --check` 通过；ESLint 仅保留原有 4 条 warning。生产构建通过，包含 2 个 Workflow、16 个步骤。

## 当前边界

- 当前只支持导入入口已允许的 PNG/JPEG，不增加 GIF/WebP、批量 OCR 或扫描件完整识别。
- 同一图片在一篇 Markdown 多次引用时只分析一次，并使用首次正文引用位置；缺失、同名歧义和超过预算的附件将在后续 D11 审计页中明确展示。
- 本阶段生成通用视觉描述，不增加问答时的 `inspect_image` 二次看图工具；只有后续评测证明细节问题无法由通用描述回答时再单独设计。
