/*
 * @Author: shaoliye shaoliye@fengmap.com
 * @Date: 2026-09-16 14:08:34
 * @LastEditors: shaoliye shaoliye@fengmap.com
 * @LastEditTime: 2026-09-16 15:34:46
 * @FilePath: \rag-agent\workflows\chat-run\index.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
/** 修改时间：2026-09-16 | 文件说明：聊天持久任务与执行期限编排，不依赖浏览器连接
 * 将聊天执行交给长任务执行中断的时候能够有依据的结束
 * 传递给workflow的ID是项目聊天的RunID
 *
 *  | edit by：Sliye */
import { sleep } from "workflow";
import { RUN_DEADLINE_MS } from "@/lib/chat/config";
import {
  expireChatExecution,
  runChatExecution,
} from "@/workflows/chat-run/steps";

/** @param runId 领域 Run ID。已开始的模型步骤恢复时明确失败，不自动拼接另一份生成。 */
export async function chatRunWorkflow(runId: string) {
  "use workflow";
  // 官方：https://useworkflow.dev/docs/api-reference/workflow/sleep；持久定时器在执行进程退出后仍可恢复。
  try {
    await Promise.race([
      runChatExecution(runId),//执行问答的step
      sleep(RUN_DEADLINE_MS).then(() => expireChatExecution(runId)),//等待期限到达，再尝试结束超时问答
    ]);
  } catch {
    // 步骤重试耗尽时也收敛领域终态；失败写入本身由 Workflow 继续持久重试。
    await expireChatExecution(runId);
  }
}
