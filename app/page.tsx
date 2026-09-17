/**
 * 修改时间：2026-09-16 | 文件说明：首页跳转至统一聊天入口 | edit by：Sliye
 */

import { redirect } from "next/navigation";

/** 首页仅负责跳转，不读取旧版会话查询参数。 */
export default function Home() {
  // 官方文档：https://nextjs.org/docs/app/api-reference/functions/redirect
  redirect("/chat");
}
