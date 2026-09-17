/** 修改时间：2026-09-16 | 文件说明：聊天 Workflow 步骤适配，领域状态留在 lib/chat | edit by：Sliye */
import { performChatRun } from "@/lib/chat/run-execution";
import { failChatRun } from "@/lib/chat/run-lifecycle";

/** @param runId 领域 Run ID。Workflow 重派时由数据库认领记录阻止重复模型调用
 * 负责进入真正的执行逻辑
*/
export async function runChatExecution(runId: string) {
  "use step";
  await performChatRun(runId);
}

/** @param runId 超过执行期限的 Run；已完成或已取消的终态不会被覆盖
 * 负责结束超期或异常执行
 */
export async function expireChatExecution(runId: string) {
  "use step";
  await failChatRun(runId, "执行中断或超过时限，已保留部分回答，请主动重试。");
}
