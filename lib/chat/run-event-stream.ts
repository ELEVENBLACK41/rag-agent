/** 修改时间：2026-09-16 | 文件说明：以数据库提交通知驱动持续 SSE，按持久游标补齐事件 | edit by：Sliye */
import { getDatabase } from "@/lib/db/client";
import { RUN_EVENT_CHANNEL } from "@/lib/chat/config";
import { getRunEvents } from "@/lib/chat/run-store";

/** 空闲时保活并检查权限/期限；正文推送由通知触发，不等待此定时器。 */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** @param runId 已通过访问检查的 Run。 @param afterSequence 已应用游标。 @param requestSignal 断线只释放订阅，不取消任务。 */
export function createRunEventStream(runId: string, afterSequence: number, requestSignal: AbortSignal) {
  const controller = new AbortController();
  const signal = AbortSignal.any([requestSignal, controller.signal]);
  const encoder = new TextEncoder();
  /** 消费者取消后不可再次关闭或写入其控制器。 */
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(output) {
      let cursor = afterSequence;
      /** 合并查询期间到达的通知；通知不是事件真值，正文始终从持久日志读取。 */
      let dirty = true;
      let wake: (() => void) | undefined;
      const notify = () => { dirty = true; wake?.(); };
      let unlisten: (() => Promise<void>) | undefined;
      let failed = false;
      signal.addEventListener("abort", notify, { once: true });
      try {
        // 官方：https://github.com/porsager/postgres#listen--notify；SDK 共用专用监听连接，重连后重新补齐日志。
        const subscription = await getDatabase().$client.listen(RUN_EVENT_CHANNEL, (id) => {
          if (id === runId) notify();
        }, notify);
        unlisten = subscription.unlisten;
        output.enqueue(encoder.encode(": connected\n\n"));
        // 先订阅再读取，避免历史查询与监听建立之间遗漏提交。
        while (!signal.aborted) {
          dirty = false;
          const events = await getRunEvents(runId, cursor);
          if (signal.aborted) break;
          if (!events) throw new Error("本轮回答不可访问。");
          for (const event of events) {
            output.enqueue(encoder.encode(`id: ${event.sequence}\nevent: replay\ndata: ${JSON.stringify(event)}\n\n`));
            cursor = event.sequence;
            if (["run_completed", "run_failed", "run_cancelled"].includes(event.eventType)) return;
          }
          if (dirty) continue;
          output.enqueue(encoder.encode(": keep-alive\n\n"));
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, HEARTBEAT_INTERVAL_MS);
            function done() { clearTimeout(timer); wake = undefined; resolve(); }
            wake = done;
            // 读取后的中止可能先于 wait 注册发生，不能把连接保留到心跳结束。
            if (signal.aborted) done();
          });
        }
      } catch {
        failed = true;
      } finally {
        signal.removeEventListener("abort", notify);
        try { await unlisten?.(); }
        catch { failed = true; }
        if (!cancelled) {
          if (failed && !signal.aborted) output.error(new Error("回答连接中断，请重新连接。"));
          else output.close();
        }
      }
    },
    cancel() { cancelled = true; controller.abort(); },
  });
}
