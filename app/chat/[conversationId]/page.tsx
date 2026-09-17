/** 修改时间：2026-09-16 | 文件说明：已有会话路由，复用聊天页面组合，由客户端加载受保护的历史记录 | edit by：Sliye */
export { default } from "@/app/chat/page";
//就是 /chat 和 /chat/[conversationId] 共用同一个聊天页面组件

export const dynamic = "force-dynamic";
