/**
 * 修改时间：2026-09-07 | 文件说明：VaultAgent 全局页面布局与主题入口 | edit by：Sliye
 */

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VaultAgent",
  description: "个人知识库聊天与审计平台",
};

/**
 * 为所有路由提供字体变量、主题 token 与 shadcn Tooltip 上下文。
 *
 * @param children 当前路由渲染的页面内容。
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
