/** 修改时间：2026-09-16 | 文件说明：桌面与移动端复用的会话目录展示 | edit by：Sliye */
"use client";
import Link from "next/link";
import { BookOpenIcon, SquarePenIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { useConversationDirectory } from "@/components/chat/use-conversation-directory";

type ConversationSidebarProps = {
  directory: ReturnType<typeof useConversationDirectory>;
  activeId: string | null;
  disabled: boolean;
  onSelect: (id: string | null) => void;
};

/** 加载、失败、空目录与分页入口均保留键盘可访问按钮。 */
export function ConversationSidebar({
  directory,
  activeId,
  disabled,
  onSelect,
}: ConversationSidebarProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-1 px-3 py-4">
      <div className="mb-5 px-2">
        <p className="text-lg font-semibold tracking-tight">VaultAgent</p>
      </div>
      <Button
        variant="ghost"
        className="h-10 justify-start gap-3 rounded-xl px-3"
        disabled={disabled}
        onClick={() => onSelect(null)}
      >
        <SquarePenIcon className="size-4" />
        新建会话
      </Button>
      <Button asChild variant="ghost" className="h-10 justify-start gap-3 rounded-xl px-3">
        <Link href="/library">
          <BookOpenIcon className="size-4" />
          管理知识库
        </Link>
      </Button>
      <div className="mt-7 flex items-center justify-between px-2 pb-1">
        <h2 className="text-xs font-medium text-muted-foreground">最近会话</h2>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="刷新会话列表"
          title="刷新会话列表"
          disabled={directory.loading}
          onClick={() => void directory.refresh()}
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
      </div>
      {directory.error && (
        <div role="alert" className="text-sm text-destructive">
          {directory.error}
        </div>
      )}
      <ScrollArea className="chat-directory min-h-0 flex-1">
        <nav aria-label="历史会话" className="space-y-0.5">
          {directory.conversations.map((conversation) => (
            <Button
              key={conversation.id}
              variant={activeId === conversation.id ? "secondary" : "ghost"}
              className="h-9 w-full min-w-0 justify-start rounded-lg px-3 text-left font-normal"
              disabled={disabled}
              aria-current={activeId === conversation.id ? "page" : undefined}
              title={conversation.title}
              onClick={() => onSelect(conversation.id)}
            >
              <span className="min-w-0 flex-1 truncate">
                {conversation.title}
              </span>
            </Button>
          ))}
          {!directory.conversations.length && !directory.error && (
            <p className="py-4 text-sm text-muted-foreground">
              {directory.loading ? "正在加载会话…" : "还没有历史会话"}
            </p>
          )}
          {directory.nextOffset !== null && (
            <Button
              className="w-full"
              variant="ghost"
              disabled={directory.loading}
              onClick={directory.loadMore}
            >
              {directory.loading ? "正在加载…" : "更多会话"}
            </Button>
          )}
        </nav>
      </ScrollArea>
    </div>
  );
}
