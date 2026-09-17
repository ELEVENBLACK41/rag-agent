/** 修改时间：2026-09-17 | 文件说明：管理数据读取失败时的可恢复界面，不回显服务端异常 | edit by：Sliye */
"use client";
import { Button } from "@/components/ui/button";
/** @param reset 重新加载当前页面数据。 */
export default function AdminError({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="space-y-4 p-6">
      <p>管理数据读取失败，请确认数据库迁移和登录配置后重试。</p>
      <Button variant="outline" onClick={reset}>
        重新加载
      </Button>
    </div>
  );
}
