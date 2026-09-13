<!--
修改时间：2026-09-13
文件说明：VaultAgent DAY6 常规 DOCX 导入、定位与内嵌图片分析实施记录。

记录 DAY6 的实际实现边界、数据库迁移和已完成验证。本文不将未进行真实
Gateway 调用的视觉模型结果描述为已验收能力。

edit by：Sliye
-->

# DAY6：DOCX 导入、位置引用与内嵌图片

状态：已完成。常规 DOCX 已作为可索引文件进入现有候选快照 Workflow；正文、表格、内嵌图片视觉分析及其后续向量化均已完成真实导入联调。

## 实现范围

- `.docx` 从附件职责调整为索引职责；格式注册表以 DOCX MIME 分派原始字节给独立解析器，Workflow 不增加格式分支。
- 使用已锁定的 Mammoth `1.12.2` 读取常规 DOCX，并显式禁止外部文件访问；`Title` 与 Word 标题样式进入标题路径。
- 正文按文档顺序产生段落 Chunk；基础表格按行、单元格转换为 ` | ` 分隔的文本 Chunk。每个 Chunk 保存标题路径、段落序号或表格序号，不伪造 Word 行号/物理页码。
- DOCX 内嵌 PNG/JPEG 以 Mammoth 的文档顺序获得 `document-image:N` 来源键。每文件最多 2 张、每批 PDF/DOCX 共最多 5 张，单图超过 2,000,000 像素不送入模型。
- 新增跨格式视觉资产服务：统一写入私有派生文件、模型/提示词版本、失败状态和视觉 Chunk。PDF 无文本页改用该服务，视觉资产以 `(file_version_id, source_key)` 唯一化，不再以 PDF 页码限定。
- PDF、DOCX 与 XLSX 共用 `visual/limits.ts` 的批次、候选数量与图片尺寸限制；不再由格式模块各自硬编码相同策略，避免修改额度时产生漂移。
- 聊天引用和导入面板支持 DOCX “段落 N / 表格 N / 内嵌图片 N”位置显示；PDF 的既有页码展示保持不变。

## 数据库迁移

`0006_woozy_exiles.sql`：

- `visual_assets.page_number` 改为可空，新增 `source_key`、`source_locator`。
- 已有 DAY5 PDF 资产迁移为 `pdf-page:N` 与对应 JSON 定位后再设为非空，避免本地已有记录导致迁移失败。
- 唯一索引由 `(file_version_id, page_number)` 调整为 `(file_version_id, source_key)`。

## 实际验证

| 检查项 | 结果 |
| --- | --- |
| DOCX fixture 解析 | 通过：`fixtures/office/vaultagent-docx-fixture.docx` 产出 4 个正文/表格 Chunk，覆盖标题上下文、普通段落和 1 个三列表格；表格定位为 `tableIndex: 1`。 |
| DOCX 内嵌图片结构 | 通过固定 fixture 的 Mammoth 转换路径读取；解析器不对正文开启外部文件访问。真实模型分析结果见下一行完整链路验证。 |
| Gateway 视觉分析完整链路 | 通过：2026-09-13 以 `vaultagent-docx-multipage-test.docx` 创建新版本批次 `e6966d42-7f6c-40e4-b702-992585ac23db`；批次与文件均为 `completed`，`document-image:1`、`document-image:2` 均为 `completed` 且无错误。Workflow 在视觉分析后完成向量化与快照发布，证明视觉 Chunk 已进入索引主链路。 |
| Drizzle 迁移生成与应用 | 通过：`pnpm db:generate`、`pnpm db:migrate`，本地数据库已成功应用 `0006`。 |
| TypeScript | 通过：`node_modules/.bin/tsc.cmd --noEmit`。 |
| ESLint | 无 DAY6 新增错误或警告；仓库仍有 2 条既有生成文件/AI Elements 警告。 |

## 当前限制

- 仅支持常规 DOCX 的标题、段落、基础表格和内嵌 PNG/JPEG；不承诺复杂布局、文本框、批注、旧版 DOC 或精确 Word 分页还原。
- 图片视觉分析是有界模型描述，不能替代正文事实；超过额度、非 PNG/JPEG、像素过大或 Gateway 调用失败时，不阻断 DOCX 正文和表格的索引发布。
- 本次已用固定 fixture 完成 Gateway 视觉分析、视觉 Chunk 向量化与快照发布的真实联调；聊天回答是否选中视觉 Chunk 仍取决于具体问题和检索排序，不能把单次导入验收等同于所有问答场景的召回验收。
