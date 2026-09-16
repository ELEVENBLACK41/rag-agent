/** 修改时间：2026-09-16 | 文件说明：聊天消息、执行过程和来源卡片的展示组合 | edit by：Sliye */
"use client";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { RunProcess } from "@/components/chat/run-process";
import { MessageImageGallery } from "@/components/chat/message-image-gallery";
import { Button } from "@/components/ui/button";
import { FileTextIcon, ImageIcon } from "lucide-react";
import type { ChatMessage } from "@/lib/chat/types";
import type { SourceCitation as Citation } from "@/lib/sources/types";

type ChatMessageListProps = {
  messages: ChatMessage[];
  hasPublishedSnapshot: boolean;
  streaming: boolean;
  history: { hasMore: boolean; loading: boolean; onLoad: () => void };
  onRetry: (runId: string) => void;
  onProcessOpen: (id: string, open: boolean) => void;
  onCitation: (message: ChatMessage, citation: Citation) => void;
};

/** 模型正文不负责图片授权；所有 Markdown/HTML 图片都交给受控画廊展示。 */
const CHAT_MARKDOWN_COMPONENTS = { img: () => null };

/** 只组合展示与交互回调，不负责请求或历史上下文。 */
export function ChatMessageList({
  messages,
  hasPublishedSnapshot,
  streaming,
  history,
  onRetry,
  onProcessOpen,
  onCitation,
}: ChatMessageListProps) {
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="mx-auto w-full max-w-[50rem] gap-9 px-5 pb-10 pt-6 sm:gap-12 sm:px-6">
        {history.hasMore && (
          <Button
            variant="ghost"
            disabled={history.loading || streaming}
            onClick={history.onLoad}
          >
            {history.loading ? "正在加载…" : "加载更早消息"}
          </Button>
        )}
        {!messages.length ? (
          <ConversationEmptyState
            className="min-h-[45dvh] [&_h3]:text-2xl [&_h3]:font-semibold [&_h3]:tracking-tight [&_p]:mt-3 [&_p]:leading-7 sm:[&_h3]:text-3xl"
            title="今天想了解什么？"
            description={
              hasPublishedSnapshot
                ? "可以直接交流，也可以围绕资料连续追问。"
                : "可以先交流；询问知识库内容前请先导入资料。"
            }
          />
        ) : (
          messages.map((message) => (
            <Message from={message.role} key={message.id} className="max-w-full gap-3">
              {message.role === "assistant" && message.process && (
                <RunProcess
                  process={message.process}
                  onOpenChange={(open) => onProcessOpen(message.id, open)}
                />
              )}
              {(message.role === "user" || message.content) && (
                <MessageContent className="text-base leading-7 group-[.is-user]:max-w-[85%] group-[.is-user]:whitespace-pre-wrap group-[.is-user]:rounded-3xl group-[.is-user]:bg-chat-user group-[.is-user]:px-5 group-[.is-user]:py-2.5 group-[.is-user]:text-chat-user-foreground group-[.is-assistant]:w-full">
                  {message.role === "assistant" ? (
                    <MessageResponse
                      components={CHAT_MARKDOWN_COMPONENTS}
                      className="chat-response"
                      isAnimating={
                        streaming && message.id === messages.at(-1)?.id
                      }
                    >
                      {message.content}
                    </MessageResponse>
                  ) : (
                    message.content
                  )}
                </MessageContent>
              )}
              {message.error && (
                <p
                  className={
                    ["interrupted", "cancelled"].includes(message.process?.status ?? "")
                      ? "text-sm text-muted-foreground"
                      : "text-sm text-destructive"
                  }
                  role="status"
                >
                  {message.error}
                </p>
              )}
              {/* 图片渲染会话中 */}
              {message.role === "assistant" && message.runId &&
                !!message.citations?.some((citation) => citation.displayImage) && (
                  <MessageImageGallery
                    citations={message.citations}
                    runId={message.runId}
                  />
                )}
              {message.role === "assistant" && message.runId && message.process?.completedAt &&
                ["failed", "cancelled"].includes(message.process.status) && (
                <Button variant="outline" size="sm" disabled={streaming} onClick={() => onRetry(message.runId!)}>
                  重新回答
                </Button>
              )}
              {message.role === "assistant" && !!message.citations?.length && (
                <div className="flex flex-wrap gap-2" aria-label="回答来源">
                  <p className="w-full text-xs text-muted-foreground">
                    回答来源
                  </p>
                  {message.citations.map((citation) => (
                    <Button
                      className="h-auto max-w-full gap-1.5 rounded-full border-border/60 bg-muted/50 px-3 py-1 text-xs font-normal text-muted-foreground shadow-none hover:text-foreground"
                      disabled={!message.runId}
                      key={citation.id}
                      onClick={() => onCitation(message, citation)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {citation.displayImage ? (
                        <ImageIcon className="size-3" />
                      ) : (
                        <FileTextIcon className="size-3" />
                      )}
                      <span className="min-w-0 truncate">{citation.displayName} · {getCitationLocation(citation)}</span>
                    </Button>
                  ))}
                </div>
              )}
            </Message>
          ))
        )}
      </ConversationContent>
      <ConversationScrollButton aria-label="回到底部" title="回到底部" />
    </Conversation>
  );
}

/** 将不同格式的来源定位转为聊天引用标签，历史行号引用继续可读。 */
function getCitationLocation(citation: Citation) {
  if (citation.sourceLocator?.format === "markdown-visual")
    return `第 ${citation.sourceLocator.lineNumber} 行 · 图片 ${citation.sourceLocator.attachmentPath} · 视觉分析`;
  if (
    citation.sourceLocator?.format === "pdf" &&
    citation.sourceLocator.pageNumber
  )
    return `第 ${citation.sourceLocator.pageNumber} 页`;
  if (
    citation.sourceLocator?.format === "pdf-visual" &&
    citation.sourceLocator.pageNumber
  )
    return `第 ${citation.sourceLocator.pageNumber} 页 · 视觉分析`;
  if (citation.sourceLocator?.format === "docx") {
    const block =
      citation.sourceLocator.blockType === "table"
        ? `表格 ${citation.sourceLocator.tableIndex ?? citation.sourceLocator.blockIndex ?? ""}`
        : `段落 ${citation.sourceLocator.blockIndex ?? ""}`;
    return block.trim();
  }
  if (
    citation.sourceLocator?.format === "docx-visual" &&
    citation.sourceLocator.imageIndex
  )
    return `内嵌图片 ${citation.sourceLocator.imageIndex} · 视觉分析`;
  if (
    citation.sourceLocator?.format === "xlsx" &&
    citation.sourceLocator.sheetName &&
    citation.sourceLocator.range
  )
    return `工作表 ${citation.sourceLocator.sheetName} · ${citation.sourceLocator.range}`;
  if (
    citation.sourceLocator?.format === "xlsx-visual" &&
    citation.sourceLocator.sheetName &&
    citation.sourceLocator.anchor &&
    citation.sourceLocator.imageIndex
  )
    return `工作表 ${citation.sourceLocator.sheetName} · ${citation.sourceLocator.anchor} · 内嵌图片 ${citation.sourceLocator.imageIndex} · 视觉分析`;
  if (citation.startLine !== null && citation.endLine !== null)
    return `${citation.startLine}-${citation.endLine} 行`;
  return "位置不可用";
}
