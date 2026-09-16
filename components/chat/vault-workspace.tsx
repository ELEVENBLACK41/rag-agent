/** 修改时间：2026-09-16 | 文件说明：会话目录、聊天展示、输入与来源抽屉的轻量组合 | edit by：Sliye */
"use client";
import { useState } from "react";
import { MenuIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SourceDrawer } from "@/components/sources/source-drawer";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ConversationSidebar } from "@/components/chat/conversation-sidebar";
import { useConversationDirectory } from "@/components/chat/use-conversation-directory";
import { useChatSession } from "@/components/chat/use-chat-session";
import type { SourceCitation } from "@/lib/sources/types";

type SourceSelection = {
  conversationId: string | null;
  runId: string;
  citation: SourceCitation;
};

/** 业务状态交给 Hook，工作台只持有抽屉等局部展示状态。 */
export function VaultWorkspace({
  hasPublishedSnapshot,
}: {
  hasPublishedSnapshot: boolean;
}) {
  const directory = useConversationDirectory();
  const chat = useChatSession(directory.refresh);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [source, setSource] = useState<SourceSelection | null>(null);
  /** 来源始终绑定原 Run，切换会话后不会把旧抽屉误当成本轮资料。 */
  const activeSource = source?.conversationId === chat.id ? source : null;
  const busy = chat.phase !== null;
  const streaming = chat.phase === "streaming";
  const select = (id: string | null) => {
    setSidebarOpen(false);
    setSource(null);
    void chat.selectConversation(id);
  };
  const sidebar = (
    <ConversationSidebar
      directory={directory}
      activeId={chat.id}
      disabled={chat.phase === "deleting"}
      onSelect={select}
    />
  );

  return (
    <main className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 bg-sidebar lg:block">
        {sidebar}
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 px-4 sm:px-6">
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button
                className="lg:hidden"
                variant="ghost"
                size="icon"
                aria-label="打开历史会话"
              >
                <MenuIcon className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-72 flex-col bg-sidebar p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>历史会话</SheetTitle>
              </SheetHeader>
              {sidebar}
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-medium text-muted-foreground">{chat.title}</h1>
          </div>
          {chat.id && (
            <>
              <Button
                disabled={busy}
                onClick={() => void chat.selectConversation(chat.id, false)}
                size="icon"
                variant="ghost"
                aria-label="刷新当前会话"
                title="刷新当前会话"
              >
                <RefreshCwIcon className="size-4" />
              </Button>
              <Button
                disabled={busy}
                onClick={() => void chat.removeConversation()}
                size="icon"
                variant="ghost"
                aria-label="删除会话"
                title="删除会话"
              >
                <Trash2Icon className="size-4" />
              </Button>
            </>
          )}
        </header>
        {chat.error && (
          <div
            className="flex items-center justify-between gap-3 px-5 py-3 text-sm text-destructive"
            role="alert"
          >
            {chat.error}
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void chat.selectConversation(chat.id, false)}
            >
              重试加载
            </Button>
          </div>
        )}
        {chat.phase === "loading" ? (
          <p role="status" className="flex-1 p-8 text-sm text-muted-foreground">
            正在加载历史消息…
          </p>
        ) : (
          <ChatMessageList
            messages={chat.messages}
            hasPublishedSnapshot={hasPublishedSnapshot}
            streaming={streaming}
            history={{
              hasMore: !!chat.nextBefore,
              loading: chat.phase === "older",
              onLoad: () => void chat.loadOlder(),
            }}
            onRetry={(runId) => void chat.retry(runId)}
            onProcessOpen={chat.setProcessOpen}
            onCitation={(message, citation) => {
              if (message.runId)
                setSource({
                  conversationId: chat.id,
                  runId: message.runId,
                  citation,
                });
            }}
          />
        )}
        <ChatComposer
          value={chat.input}
          onChange={chat.setInput}
          onSubmit={chat.submitQuestion}
          onStop={chat.stop}
          streaming={streaming}
          disabled={busy || !!chat.error}
        />
      </section>
      <SourceDrawer
        citation={activeSource?.citation ?? null}
        runId={activeSource?.runId ?? null}
        onOpenChange={(open) => {
          if (!open) setSource(null);
        }}
      />
    </main>
  );
}
