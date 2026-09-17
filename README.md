<!-- 修改时间：2026-09-17 | 文件说明：VaultAgent 开源项目说明、安装、配置与贡献入口 | edit by：Sliye -->

# VaultAgent

> 面向个人知识库的可追溯 AI 助手：导入自己的笔记与文档，基于已读取证据问答，并回到对应的原文、页码或图片。

VaultAgent 是一个个人 RAG（检索增强生成）应用。它将文件导入、版本化快照、混合检索、受限工具调用、流式问答和来源定位放进同一条链路。目标不是让模型“猜得像”，而是让回答能说明依据、展示来源，并在资料变化或执行失败时保持可追溯。

> **项目状态：积极开发中。** 当前代码适合本地单人部署和开发验证，公开部署前请先完成下方的安全检查和许可证配置。

## 目录

- [适用场景](#适用场景)
- [核心能力](#核心能力)
- [支持范围](#支持范围)
- [工作方式](#工作方式)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [常用命令](#常用命令)
- [项目结构](#项目结构)
- [隐私与安全](#隐私与安全)
- [部署说明](#部署说明)
- [贡献指南](#贡献指南)
- [开源发布前检查](#开源发布前检查)
- [许可证](#许可证)

## 适用场景

- 导入 Markdown、Obsidian Vault ZIP、TXT、PDF、DOCX、XLSX 等个人资料。
- 围绕已导入资料进行多轮问答，查看文本、页码、表格位置或可展示图片等来源。
- 管理文档版本：每次问答固定到一个已发布快照，避免回答期间混用新旧资料。
- 按需进行有限网页搜索，并将网页来源与本地知识库来源分开展示。
- 审阅知识库中的结构问题、失效链接/附件、重复候选和原文定位信息。

## 核心能力

### 可追溯知识库问答

- 对话、消息、执行任务（Run）和事件独立持久化；刷新或短暂断线后可按事件恢复。
- 受限多步 Agent 可查询文件清单、搜索知识库、读取已授权片段，并按需联网搜索。
- 最终回答仅能引用本轮实际读取的本地证据或实际返回的网页摘要；来源与 Markdown 正文分离展示。
- 支持取消和主动重试；失败会保留公开过程与部分回答，不伪装为成功。

### 多格式导入与版本快照

- 支持 `.md`、`.txt`、`.pdf`、`.docx`、`.xlsx`、`.png`、`.jpg`、`.jpeg`，以及包含这些文件的 ZIP。
- 原始文件先写入私有存储，再由持久化 Workflow 执行解析、可选视觉分析、Embedding 和快照发布。
- 文件更新不会覆盖历史引用：问答固定读取当时的已发布快照。

### 检索、图片与来源查看

- 中文关键词、向量检索、RRF 融合与 rerank 组合，保留脱敏检索 Trace。
- Markdown、DOCX、XLSX 的内嵌 PNG/JPEG，以及部分 PDF 页面可产生有界视觉资源。
- 支持查看引用片段、PDF 页、原文件和可展示图片。普通附件引用不冒充为可直接展示图片。
- 图片无法展示时降级为明确说明，不因单条图片引用让整轮回答失败。

### 运行观测与访问控制

- 管理侧记录运行配置快照、模型调用、工具调用、耗时和费用信息。
- 本地模式面向单一所有者；GitHub OAuth 和 `OWNER_GITHUB_ID` 用于限制管理能力。
- 私有文件经服务端受控读取，不向浏览器暴露存储键。

## 支持范围

| 类型 | 当前能力 | 说明 |
| --- | --- | --- |
| Markdown / TXT | 支持 | 按标题、段落与代码等结构切块；保留 Markdown 位置和附件关系。 |
| Obsidian Vault ZIP | 支持 | 安全解压后按相对路径导入；不回写原 Vault。 |
| PDF | 有限支持 | 索引文本层并保留物理页码；无文本页可在额度内视觉分析。复杂版式和 OCR 不在当前保证范围。 |
| DOCX | 有限支持 | 读取常规标题、段落、基础表格和内嵌 PNG/JPEG；不承诺复杂排版保真。 |
| XLSX | 有限支持 | 读取基础工作表、单元格、公式缓存值和内嵌 PNG/JPEG；不等同于完整 Excel 渲染器。 |
| PNG / JPEG | 支持 | 作为附件保存；可按导入策略进行有界视觉分析。 |
| 网页搜索 | 有限支持 | 由用户在聊天中按需启用，最多展示本轮实际使用的少量网页来源；不声称已通读完整网页。 |

## 工作方式

```text
上传文件 / ZIP
  → 原始文件私有存储
  → Workflow：解析、视觉分析、向量化
  → 原子发布索引快照
  → 聊天 Run 固定快照
  → 受限检索与读取证据
  → 结构化最终回答 + 可定位来源
```

- **文件清单不等于正文证据。** 文件名、路径和数量可以回答目录问题，不能据此断言文件内容。
- **历史回答不等于当前证据。** 多轮上下文只用于理解追问；每一轮仍会重新授权并读取当前快照中的证据。
- **过程说明不包含模型私密推理。** 界面只显示脱敏的阶段进度与工具活动。
- **外部网页不是指令。** 网页内容仅作为外部资料摘要，不能改变应用权限、任务目标或数据边界。

## 技术栈

| 层级 | 主要技术 |
| --- | --- |
| Web 与 UI | Next.js 16、React 19、TypeScript、Tailwind CSS、shadcn/ui、AI Elements |
| AI 编排 | Vercel AI SDK、Vercel AI Gateway、Vercel WorkFlow |
| 检索 | PostgreSQL、pgvector、关键词检索、RRF、Voyage rerank |
| 数据与任务 | Drizzle ORM、PostgreSQL、Vercel Workflow DevKit |
| 文件解析 | unified/remark、PDF.js、Mammoth、ExcelJS、OOXML 有界解析 |
| 文件存储 | 本地文件系统或 Vercel 私有 Blob |
| 认证 | Auth.js + GitHub OAuth（管理能力） |

## 快速开始

### 前置条件

- Node.js `22.x`
- pnpm `10.x`
- Docker Desktop（用于本地 PostgreSQL + pgvector）
- 一个可用的 Vercel AI Gateway Key

### 1. 克隆并安装依赖

```bash
git clone <your-fork-or-repository-url>
cd rag-agent
pnpm install
```

### 2. 创建本地环境文件

macOS / Linux：

```bash
cp .env.example .env.local
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env.local
```

至少设置 `AI_GATEWAY_API_KEY`。本地数据库、Workflow 和文件系统存储的默认值已在 `.env.example` 中提供。

### 3. 启动数据库并执行迁移

```bash
docker compose up -d
pnpm db:migrate
```

开发环境默认将 PostgreSQL 映射到 `localhost:5433`。确认容器健康后再执行迁移。

### 4. 启动应用

```bash
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。首次可从知识库页面导入资料；文件解析和索引由后台 Workflow 执行。

### 故障排查

- `DATABASE_URL is required`：确认 `.env.local` 已创建，并从项目根目录启动开发服务器。
- 无法连接 PostgreSQL：执行 `docker compose ps`，确认 `postgres` 为 `healthy`，并检查 5433 端口。
- 向量检索或视觉分析不可用：检查 `AI_GATEWAY_API_KEY`；这些能力会向 AI Gateway 发送必要资料内容。
- 数据库结构不匹配：先备份本地数据，再执行 `pnpm db:migrate`；不要手动修改生产数据库表结构。

## 环境变量

以 [.env.example](./.env.example) 为唯一模板。不要提交 `.env.local`、数据库连接串、OAuth Secret、Gateway Key 或真实知识库文件。

| 变量 | 本地是否必需 | 用途 |
| --- | --- | --- |
| `AI_GATEWAY_API_KEY` | 是 | 调用生成、Embedding、rerank 和视觉分析。 |
| `DATABASE_URL` | 是 | 应用 PostgreSQL 连接串。 |
| `APP_MODE` | 是 | 本地开发通常为 `local`。 |
| `DATA_DIR` | 文件系统存储时是 | 本地原始文件与派生资源目录。 |
| `STORAGE_PROVIDER` | 是 | `filesystem` 或 `blob`。 |
| `WORKFLOW_TARGET_WORLD` | 是 | 本地 Workflow World 标识。 |
| `WORKFLOW_POSTGRES_URL` | 是 | Workflow 使用的 PostgreSQL 连接串。 |
| `BLOB_STORE_ID` | 使用 Blob 时是 | Vercel 私有 Blob Store 标识。 |
| `AUTH_SECRET` | 启用认证时是 | Auth.js 会话密钥。 |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | 启用认证时是 | GitHub OAuth 凭据。 |
| `OWNER_GITHUB_ID` | 启用管理端时是 | 管理员 GitHub 数字用户 ID，不是用户名。 |
| `APP_CODE_VERSION` | 否 | 管理观测中展示的代码版本。 |

## 常用命令

```bash
pnpm dev             # 本地开发
pnpm build           # 生产构建
pnpm start           # 启动已构建应用
pnpm lint            # 代码检查
pnpm db:migrate      # 应用数据库迁移
pnpm db:generate     # 生成 Drizzle 迁移文件
docker compose up -d # 启动本地 PostgreSQL
docker compose down  # 停止本地 PostgreSQL
```

> `docker compose down` 不会主动删除命名卷。如需清理本地数据库和知识库数据，请先备份，并明确执行 Docker 卷删除操作。

## 项目结构

```text
app/                 Next.js 路由、页面与 API 入口
components/          聊天、导入、来源和通用 UI 组件
lib/
  agent/             受限 Agent、工具和执行状态
  chat/              Run 生命周期、流式事件、最终回答与引用校验
  ingestion/         上传校验、格式解析、ZIP 与视觉资产处理
  retrieval/         关键词、向量、融合和 rerank 检索
  sources/           快照授权、来源读取与定位
  storage/           本地文件系统与私有 Blob 抽象
  db/                Drizzle Schema 与数据库客户端
workflows/           持久化导入与聊天执行任务
drizzle/             PostgreSQL 迁移文件
evals/               脱敏评测资料与说明
doc/                 设计、实施记录与已知边界
fixtures/            不含私人数据的格式样本
```

## 隐私与安全

- 本地存储不代表完全离线。启用云端模型、Embedding、rerank、视觉分析或网页搜索时，相关请求内容会发送给相应服务提供方。
- 原始文件通过服务端受控读取；不要将对象存储配置为公开读，也不要在客户端暴露存储键或服务端密钥。
- 生产部署必须配置 HTTPS、强随机 `AUTH_SECRET` 和明确的所有者访问控制。不要把开发模式直接暴露到公网。
- 公共体验、多用户隔离、访客过期清理、配额和滥用防护需要独立部署审查；当前本地模式按单人使用设计。
- 导入陌生 ZIP 或文档时仍应保持谨慎。项目对路径、大小、数量和容器做边界校验，但不能替代恶意文件防护、备份策略或组织安全制度。

安全问题请不要在公开 Issue 中附带密钥、私人文件或可利用细节。请先通过维护者公开的私密联系方式报告；在正式渠道建立前，请勿提交敏感样本。

## 部署说明

支持两种存储形态：

- **本地自部署**：PostgreSQL + pgvector 由 Docker Compose 运行，文件存于本地私有目录，适合个人开发和单人使用。
- **Vercel 托管**：应用部署到 Vercel，使用私有 Blob 和托管 PostgreSQL。目标环境需独立配置环境变量和数据库迁移。

部署前至少完成以下事项：

1. 为目标环境创建独立数据库与私有文件存储。
2. 配置 `AI_GATEWAY_API_KEY`、认证变量和生产 HTTPS 回调地址。
3. 在目标数据库执行 `pnpm db:migrate`。
4. 验证“上传 → 索引 → 提问 → 来源查看 → 删除”的完整流程。
5. 制定 PostgreSQL 与原始文件的一致备份、恢复和删除策略。

当前仓库未提供一键生产部署脚本；请根据自己的身份认证、域名、存储与合规要求完成部署配置。
