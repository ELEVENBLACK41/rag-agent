/*
 * @Author: shaoliye shaoliye@fengmap.com
 * @Date: 2026-09-16 14:08:30
 * @LastEditors: shaoliye shaoliye@fengmap.com
 * @LastEditTime: 2026-09-16 15:43:31
 * @FilePath: \rag-agent\lib\chat\run-execution.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
/** 修改时间：2026-09-17 | 文件说明：持久执行认领、联网授权恢复、取消监视与模型执行边界 | edit by：Sliye */
import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { messages, runEvents } from "@/lib/db/schema";
import { appendRunEvent, failChatRun, finishRun, insertRunEvent, reconcileChatRun, withLockedRun } from "@/lib/chat/run-lifecycle";
import { RUN_DEADLINE_MS } from "@/lib/chat/config";
import { ChatExecutionError, executeChatRun } from "@/lib/chat/runs";

/** @param runId Run ID。持久认领后不再次调用模型；重复派送收敛为明确失败。 */
async function claimChatRun(runId: string) {
  return withLockedRun(runId, async (tx, run) => { //枷锁
    if (run.status !== "running") return null;
    const [started] = await tx
      .select({ id: runEvents.id })
      .from(runEvents)
      .where(
        and(
          eq(runEvents.runId, runId),
          eq(runEvents.eventType, "execution_started"),
        ),
      )
      .limit(1);
    if (started || Date.now() - run.createdAt.getTime() >= RUN_DEADLINE_MS) {
      await finishRun(
        tx,
        run,
        "failed",
        "执行中断，已保留部分回答，请主动重试。",
      );
      return null;
    }
    await insertRunEvent(tx, runId, "execution_started", {});
    // 旧 Run 没有联网选项时保持关闭，不能从会话历史推断授权。
    const [configuration] = await tx.select({ payload: runEvents.payload }).from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.eventType, "run_started"))).limit(1);
    return {
      runId,
      conversationId: run.conversationId,
      snapshotId: run.snapshotId,
      webSearchEnabled: !!configuration?.payload && typeof configuration.payload === "object" && "webSearchEnabled" in configuration.payload && configuration.payload.webSearchEnabled === true,
    };
  });
}

/** @param runId 只传标识到 Workflow；私人问题和上下文从领域数据库读取。 */
export async function performChatRun(runId: string) {
  /**
   * 执行前现认领,认领逻辑会加数据库锁
   * 数据库的情况:Run 已完成、失败或取消,   直接退出
   * Run 仍运行，且没有执行开始记录      写入 execution_started，允许开始
   * 已有 execution_started，但仍没有终态       标记失败，不重新调用模型
   * 已超过期限      标记失败
   */
  const chatRun = await claimChatRun(runId);
  if (!chatRun) return;
  /** 数据库状态是取消真值，AbortController 只负责中止当前可中止的模型请求。 */
  const controller = new AbortController();
  /** 独立请求期限避免数据库检查阻塞时模型请求失去超时约束。 */
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(RUN_DEADLINE_MS)]);//执行器发现用户取消、会话删除或状态异常，调用 controller.abort(),当前执行达到请求超时，自动中止
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const assertActive = async () => {
    signal.throwIfAborted();
    const status = await reconcileChatRun(runId);
    if (status !== "running") {
      controller.abort(new Error("本轮执行已停止或会话已删除。"));
      signal.throwIfAborted();
    }
  };
  /** 串行轮询避免慢数据库导致重叠请求；工具启动前另行检查，不依赖轮询窗口。 */
  const monitor = async () => {
    try {
      await assertActive();
    } catch (error) {
      controller.abort(error);
    }
    if (!disposed && !signal.aborted)
      timer = setTimeout(() => void monitor(), 500);
  };
  try {
    await assertActive();
    timer = setTimeout(() => void monitor(), 500);
    const [question] = await getDatabase()
      .select({ content: messages.content })
      .from(messages)
      .where(and(eq(messages.runId, runId), eq(messages.role, "user")))
      .limit(1);
    if (!question) throw new Error("本轮问题记录不可用。");
    for await (const event of executeChatRun(chatRun, question.content, {//持续接受公开事件给前端
      signal,
      assertActive,
    })) {
      // 完成事件已经与最终消息、Run 终态原子提交。所有其他公开事件先保存，订阅端才可看到。
      if (event.type !== "complete")
        await appendRunEvent(runId, "stream_event", event);
    }
  } catch (error) {
    await failChatRun(
      runId,
      error instanceof ChatExecutionError
        ? error.message
        : "回答执行失败，已保留部分内容，请主动重试。",
    );
  } finally {
    disposed = true;
    clearTimeout(timer);
    controller.abort();
  }
}
