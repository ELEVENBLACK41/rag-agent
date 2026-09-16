/** 修改时间：2026-09-16 | 文件说明：桌面与移动端复用的会话目录展示 | edit by：Sliye */
"use client";
import Link from "next/link";
import { BookOpenIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
    <div className="flex h-full min-h-0 flex-col gap-4 p-5">
      <div>
        <p className="text-lg font-semibold">VaultAgent</p>
        <p className="text-sm text-muted-foreground">多格式知识问答</p>
      </div>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => onSelect(null)}
      >
        <PlusIcon className="size-4" />
        新建会话
      </Button>
      <Button asChild variant="ghost">
        <Link href="/library">
          <BookOpenIcon className="size-4" />
          管理知识库
        </Link>
      </Button>
      <Separator />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">历史会话</h2>
        <Button
          size="sm"
          variant="ghost"
          disabled={directory.loading}
          onClick={() => void directory.refresh()}
        >
          刷新列表
        </Button>
      </div>
      {directory.error && (
        <div role="alert" className="text-sm text-destructive">
          {directory.error}
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label="历史会话" className="space-y-1 pr-2">
          {directory.conversations.map((conversation) => (
            <Button
              key={conversation.id}
              variant={activeId === conversation.id ? "secondary" : "ghost"}
              className="h-auto w-full min-w-0 justify-start py-3 text-left"
              disabled={disabled}
              aria-current={activeId === conversation.id ? "page" : undefined}
              title={conversation.title}
              onClick={() => onSelect(conversation.id)}
            >
              <MessageSquareIcon className="size-4 shrink-0" />
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
      <p className="text-xs leading-5 text-muted-foreground">
        删除会话不会删除知识库文件。
      </p>
    </div>
  );
}
