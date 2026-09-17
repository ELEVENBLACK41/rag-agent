/** 修改时间：2026-09-17 | 文件说明：聊天执行器与监控共用的实际模型、预算和期限配置 | edit by：Sliye */
/** Agent 与最终回答共同使用的主模型。 */
export const CHAT_MODEL = "alibaba/qwen3.7-flash";
/** 最多模型步骤数，限制循环与费用。 */
export const MAX_AGENT_STEPS = 8;
/** 每个收集步骤的输出 Token 上限。 */
export const MAX_AGENT_OUTPUT_TOKENS = 1_200;
/** 最终回答的输出 Token 上限。 */
export const MAX_OUTPUT_TOKENS = 3_600;
/** 包含排队时间的 Run 总期限，毫秒；不等同于浏览器请求超时。 */
export const RUN_DEADLINE_MS = 120_000;
/** 提交后的事件唤醒通道；通知只携带 Run ID，不传递私人正文。 */
export const RUN_EVENT_CHANNEL = "chat_run_events";
