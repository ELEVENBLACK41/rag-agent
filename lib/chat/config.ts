/** 修改时间：2026-09-16 | 文件说明：聊天执行器、持久定时器共用的期限配置 | edit by：Sliye */
/** 包含排队时间的 Run 总期限，毫秒；不等同于浏览器请求超时。 */
export const RUN_DEADLINE_MS = 120_000;
/** 提交后的事件唤醒通道；通知只携带 Run ID，不传递私人正文。 */
export const RUN_EVENT_CHANNEL = "chat_run_events";
