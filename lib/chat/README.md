<!-- 修改时间：2026-09-16 | 文件说明：VaultAgent 聊天领域、历史上下文与客户端分层说明 | edit by：Sliye -->

# Chat 领域

`runs.ts` 负责一次问答的执行编排：加载会话上下文、执行 Agent、重新授权证据、流式生成最终回答。数据库写入集中在 `run-store.ts`，不在页面或 API 中重复实现。

| 文件 | 职责 |
| --- | --- |
| `conversations.ts` | 工作区内会话目录、访问检查、软删除 |
| `conversation-history.ts` | 以完整问答分页恢复消息、来源、执行过程及失败状态 |
| `conversation-context.ts` | 只取当前会话最近已完成问答，按轮数与字符预算组装两个模型阶段共享的上下文 |
| `run-store.ts` | 创建 Run、固定快照、事件授权读取、事件序号与终态提交 |
| `message-state.ts` | 客户端实时事件与服务端历史回放共用的纯状态转换 |
| `types.ts` | 前后端共享的公开事件和历史展示契约 |
| `final-answer.ts` / `citations.ts` | 正文与来源独立输出，以及本轮来源归属校验 |

客户端 `components/chat/vault-workspace.tsx` 只做组合与抽屉状态。`use-chat-session.ts` 管理当前会话请求生命周期，`use-conversation-directory.ts` 管理目录；侧栏、消息列表和输入框分别展示，不新增状态库。

历史只用于理解指代和承接当前要求，不能授权旧 Chunk 或沿用旧引用编号。新 Run 仍取最新已发布快照。新正文直接显示，旧事件回放根据格式信息解码历史编号。未完成 Run 仅恢复已保存内容，不假装后台任务已经恢复运行。

- `lib/agent/`：受限工具、调用/上下文预算和多步 Agent 装配；检索只在 Run 的
  固定快照中执行，最终引用只来自已读取证据。
- `lib/sources/`：从 Run、快照、Chunk 和文件版本重新校验后读取来源；浏览器只
  通过 API 访问解析片段、PDF 原文件或视觉派生图片。
- `lib/retrieval/`：关键词、向量、RRF、rerank 与不含正文的检索 Trace。

聊天领域继续复用现有四张表：
conversations
    └── messages
    └── runs
            └── run_events
