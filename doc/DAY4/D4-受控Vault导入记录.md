<!-- 修改时间：2026-09-10 | 文件说明：VaultAgent DAY4 受控 Vault 导入、版本快照与引用定位实施记录 | edit by：Sliye -->

# DAY4 受控 Vault 导入记录

状态：已完成。本阶段将 D3 的“单文件即单个可检索快照”改为批次候选快照；多文件或 ZIP 只有在整批就绪后才会替换当前检索范围。

## 已完成实现

- 新增 `import_batches` 与 `index_snapshot_files`。快照显式保存文件版本成员；发布新批次时继承旧快照的未替换文件版本，并以相对路径识别同一个逻辑文件的新版本。
- 迁移回填 D3 已有 `chunks` 的快照成员，避免升级后旧资料突然无法检索。
- 导入入口支持多选、拖拽与 ZIP。D4 会解析并索引 Markdown/TXT；PNG/JPEG、PDF、DOCX、XLSX 可随 ZIP 或多文件一同保存为附件，但不标记为已解析。
- ZIP 不落地解压；限制提交/解压后总大小和文件数，拒绝路径穿越、符号链接、嵌套 ZIP、加密 ZIP、重复相对路径与未支持类型。
- ZIP 文件名读取原始字节：优先 Unicode Path/UTF-8，未声明 UTF-8 的 Windows 中文压缩包回退 GB18030，避免被 ZIP 标准默认的 CP437 错误解码为乱码。
- Markdown Chunk 保存标题路径、Obsidian Block ID、wiki/Markdown 链接和附件目标，保留原始行号，供后续原文抽屉和稳定引用使用。
- 删除文件时生成排除该逻辑文件的新快照；历史 Run 仍固定关联原快照。
- 聊天检索改为按快照成员查询，不再只读取最后导入的那一个文件。
- 聊天工作台拆出导入状态 Hook 与导入面板；桌面侧栏和移动端均有导入入口。
- 完成格式层收口：ZIP 容器、安全路径、格式声明、Markdown/TXT 解析器和批次 Workflow Step 分别放在独立模块；后续 PDF、DOCX、XLSX 仅需新增对应解析器并注册，不会继续堆入上传入口或 Markdown 工作流。
- Workflow 指令边界仅保留在 `workflows/ingest-import-batch/steps.ts`；`lib/ingestion` 是可复用领域服务，不携带 `"use step"`。

## 已完成验证

| 检查项 | 结果 |
| --- | --- |
| Drizzle 迁移 | 通过，`0002` 新建批次/快照成员并回填 D3 数据；`0003` 增加来源定位字段 |
| 多文件 Markdown/TXT 导入 | 通过，两份无敏感回归样本在同一批次完成并发布 |
| ZIP 导入 | 通过，ZIP 内 Markdown/TXT 读取、索引并发布 |
| ZIP Office 附件 | 通过，DOCX/XLSX 状态为附件已保存，未伪装为已解析文本 |
| 增量版本 | 通过，同一 `sourcePath` 第二次导入生成新版本；最新快照只使用新版本内容 |
| 真实检索与引用 | 通过，Gateway 问答检索多文件快照并返回真实 Chunk 行号引用 |
| 文件删除 | 通过，删除测试文件后发布排除该逻辑文件的新快照；测试数据随后清理 |
| TypeScript、ESLint、生产构建 | 通过；ESLint 仅保留两条既有第三方/生成文件警告 |
| 浏览器检查 | 通过，桌面与 390px 移动端均显示导入入口；无错误覆盖层和控制台错误 |

## 当前限制

- D4 仅向量化 Markdown/TXT。图片、PDF、DOCX、XLSX 仅作为原始附件保存；其文本/视觉解析分别进入 D5、D6、D7。
- ZIP 不是任意文件容器：仅接受本阶段声明的 Markdown、TXT、PNG/JPEG、PDF、DOCX、XLSX，其他格式明确拒绝。
- 当前聊天界面仍是 D3 的单轮问答形态；多轮追问、混合检索、rerank 和 Agent 工具循环仍按 D8-D10 实施。
- 当前导入面板展示最近一个批次；完整文件管理页按 `/library` 路由规划后续补齐。
