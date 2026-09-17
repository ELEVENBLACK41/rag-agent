/*
 * @Author: shaoliye shaoliye@fengmap.com
 * @Date: 2026-09-17 15:17:42
 * @LastEditors: shaoliye shaoliye@fengmap.com
 * @LastEditTime: 2026-09-17 15:24:49
 * @FilePath: \rag-agent\app\admin\layout.tsx
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
/** 修改时间：2026-09-17 | 文件说明：管理区域导航与 GitHub 所有者登录入口 | edit by：Sliye */
import Link from "next/link";
import type { ReactNode } from "react";
import {
  isOwner,
  isOwnerAuthConfigured,
  signIn,
  signOut,
} from "@/lib/auth/owner";
import { Button } from "@/components/ui/button";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "运行监控 · VaultAgent",
  robots: { index: false, follow: false },
};

/** @param children 各页面自行鉴权后加载的管理数据。 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (!(await isOwner()))
    return (
      <main className="mx-auto max-w-xl space-y-5 px-6 py-16">
        <h1 className="text-2xl font-semibold">所有者管理</h1>
        <p className="text-sm text-muted-foreground">
          仅知识库所有者可以查看运行与用量记录。
        </p>
        {isOwnerAuthConfigured() ? (
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: "/admin" });
            }}
          >
            <Button>使用 GitHub 登录</Button>
          </form>
        ) : (
          <p className="rounded-md bg-muted p-4 text-sm leading-7">
            管理登录尚未配置。请在服务端设置
            AUTH_SECRET、AUTH_GITHUB_ID、AUTH_GITHUB_SECRET 和
            OWNER_GITHUB_ID，然后重启服务。
          </p>
        )}
        <Link href="/chat" className="text-sm text-link underline">
          返回聊天
        </Link>
      </main>
    );
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
        <div>
          <p className="text-xs tracking-wider text-muted-foreground">
            VaultAgent / 所有者
          </p>
          <h1 className="mt-2 text-2xl font-semibold">运行监控</h1>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/chat" });
          }}
        >
          <Button variant="outline">退出登录</Button>
        </form>
      </header>
      <nav aria-label="管理导航" className="flex flex-wrap gap-5 text-sm">
        <Link href="/admin" className="text-link underline">
          运行总览
        </Link>
        <Link href="/admin/configuration" className="text-link underline">
          配置与指标
        </Link>
        <Link href="/admin/reports" className="text-link underline">
          评测报告
        </Link>
      </nav>
      {children}
    </main>
  );
}
