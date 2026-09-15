<!-- 修改时间：2026-09-15 | 文件说明：VaultAgent 聊天领域职责说明 | edit by：Sliye -->

# Chat 领域

`runs.ts` 是稳定公共入口，具体职责按领域拆分：

- `query-router.ts`：使用结构化输出选择 `direct / retrieve / agent`。
- `run-execution.ts`：只编排三条执行路径。
- `run-process-stream.ts`：把 Agent 流转换为公开阶段和工具事件。
- `answer-stream.ts`：生成并持久化唯一最终回答。
- `run-store.ts`、`run-events.ts`：分别管理 Run 生命周期和顺序事件。

- `lib/agent/tools/`：一个文件对应一项稳定工具职责，`index.ts` 只组装工具注册表。
- `lib/agent/`：调用/上下文预算和多步 Agent 装配；初始检索不经过 Agent 工具，
  只有证据不足时允许一次补搜。
- `lib/sources/`：从 Run、快照、Chunk 和文件版本重新校验后读取来源；浏览器只
  通过 API 访问解析片段、PDF 原文件或视觉派生图片。
- `lib/retrieval/`：关键词、向量、RRF、rerank 与不含正文的检索 Trace。

聊天持久化主要操作四张表：
conversations
    └── messages
    └── runs
            └── run_events
