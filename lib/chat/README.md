<!-- 修改时间：2026-09-16 | 文件说明：VaultAgent 聊天领域、历史上下文与客户端分层说明 | edit by：Sliye -->

# Chat 领域

`runs.ts` 负责一次问答的执行编排：加载会话上下文、执行 Agent、重新授权证据、流式生成最终回答。创建与授权读取位于 `run-store.ts`，并发写入和终态由 `run-lifecycle.ts` 统一保护，不在页面或 API 中重复实现。

| 文件 | 职责 |
| --- | --- |
| `conversations.ts` | 工作区内会话目录、访问检查、软删除 |
| `conversation-history.ts` | 以完整问答分页恢复消息、来源、执行过程及失败状态 |
| `conversation-context.ts` | 只取当前会话最近已完成问答，按轮数与字符预算组装两个模型阶段共享的上下文 |
| `run-store.ts` | 创建 Run、重试关联、固定快照和事件授权读取 |
| `run-lifecycle.ts` | 会话/Run 行锁、事件序号、终态原子提交、取消与超期收敛 |
| `run-execution.ts` | 持久认领、取消监视和公开事件保存 |
| `run-progress.ts` | 模型流向公开阶段和工具活动的纯转换 |
| `config.ts` | 执行器与 Workflow 共用的期限 |
| `message-state.ts` | 客户端实时事件与服务端历史回放共用的纯状态转换 |
| `types.ts` | 前后端共享的公开事件和历史展示契约 |
| `final-answer.ts` / `citations.ts` | 正文与来源独立输出，以及本轮来源归属校验 |

客户端 `components/chat/vault-workspace.tsx` 只做组合与抽屉状态。`use-chat-session.ts` 管理当前会话请求生命周期，`use-conversation-directory.ts` 管理目录；侧栏、消息列表和输入框分别展示，不新增状态库。

历史只用于理解指代和承接当前要求，不能授权旧 Chunk 或沿用旧引用编号。新 Run 仍取最新已发布快照。新正文直接显示，旧事件回放根据格式信息解码历史编号。运行中的 Run 恢复已保存事件后按游标继续订阅；`workflows/chat-run/` 持久派发执行。已认领的模型步骤被重新派送时明确失败，不拼接第二次模型生成。取消和删除阻止迟到事件与完成写回。主动重试创建新尝试并替换旧显示，保留旧尝试记录。

订阅使用单条持续 SSE 连接，只在异常断线后按游标重连；客户端断开不取消后台。`run-event-stream.ts` 监听 PostgreSQL 事务提交通知并读取新事件，正文不依赖轮询窗口。所有公开增量先存储再展示，`message-state.ts` 按事件序号去重。Model/Agent 内部状态未做逐步骤持久化，因此不承诺模型中途原地续写。

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
