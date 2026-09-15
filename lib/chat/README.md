<!-- 修改时间：2026-09-14 | 文件说明：VaultAgent 聊天领域职责说明 | edit by：Sliye -->

# Chat 领域

`runs.ts` 负责一次问答的业务编排：创建会话与 Run、固定资料快照、发布 SSE
事件、持久化最终消息/引用以及处理失败。它不会直接定义 Agent 工具或读取原文件。

- `lib/agent/`：受限工具、调用/上下文预算和多步 Agent 装配；检索只在 Run 的
  固定快照中执行，最终引用只来自已读取证据。
- `lib/sources/`：从 Run、快照、Chunk 和文件版本重新校验后读取来源；浏览器只
  通过 API 访问解析片段、PDF 原文件或视觉派生图片。
- `lib/retrieval/`：关键词、向量、RRF、rerank 与不含正文的检索 Trace。

目前主要run.ts 主要操作四张表
conversations
    └── messages
    └── runs
            └── run_events
