/** 修改时间：2026-09-16 | 文件说明：跨聊天、知识库与审计路由持久保留的侧栏及会话上下文 | edit by：Sliye */
"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MenuIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ConversationSidebar } from "@/components/chat/conversation-sidebar";
import { useConversationDirectory } from "@/components/chat/use-conversation-directory";
import { useChatSession } from "@/components/chat/use-chat-session";

/** 会话状态由持久布局持有，右侧路由卸载不会丢失草稿或中断流式订阅。 */
const WorkspaceChatContext = createContext<ReturnType<typeof useChatSession> | null>(null);

/** 读取布局唯一的聊天状态，避免各页面重复创建会话订阅。 */
export function useWorkspaceChat() {
  const chat = useContext(WorkspaceChatContext);
  if (!chat) throw new Error("聊天页面必须位于 WorkspaceShell 中。");
  return chat;
}

/**
 * 保留侧栏实例与滚动位置，只替换右侧路由内容；小屏使用同一导航的 Sheet。
 * @param children Next.js 当前路由的页面内容。
 */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const directory = useConversationDirectory();
  const chat = useChatSession(directory.refresh);
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const inChat = pathname === "/chat" || pathname.startsWith("/chat/");
  const sidebar = <ConversationSidebar
    directory={directory}
    activeId={inChat ? chat.id : null}
    activePath={pathname}
    disabled={chat.phase === "deleting"}
    onNavigate={() => setSidebarOpen(false)}
    onSelect={(id) => {
      setSidebarOpen(false);
      if (inChat) void chat.selectConversation(id);
      else {
        // “新建”始终清空草稿；返回同一已有会话则保留当前消息与订阅。
        if (!id || id !== chat.id) void chat.selectConversation(id, false);
        router.push(id ? `/chat/${encodeURIComponent(id)}` : "/chat");
      }
    }}
  />;

  return <WorkspaceChatContext.Provider value={chat}>
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside aria-label="工作区导航" className="hidden h-full w-64 shrink-0 bg-sidebar lg:block">
        {sidebar}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3 lg:hidden">
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="打开工作区导航"><MenuIcon className="size-4" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-72 flex-col bg-sidebar p-0">
              <SheetHeader className="sr-only"><SheetTitle>工作区导航</SheetTitle></SheetHeader>
              {sidebar}
            </SheetContent>
          </Sheet>
          <span className="text-sm font-medium">VaultAgent</span>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  </WorkspaceChatContext.Provider>;
}
