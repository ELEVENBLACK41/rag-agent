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
import { Button } from "@/components/ui/button";
import { FileTextIcon, MessageSquareIcon } from "lucide-react";
import { getVisibleAnswer } from "@/lib/chat/citations";
import type { ChatMessage } from "@/lib/chat/types";
import type { SourceCitation as Citation } from "@/lib/sources/types";

type ChatMessageListProps = {
  messages: ChatMessage[];
  hasPublishedSnapshot: boolean;
  streaming: boolean;
  history: { hasMore: boolean; loading: boolean; onLoad: () => void };
  onProcessOpen: (id: string, open: boolean) => void;
  onCitation: (message: ChatMessage, citation: Citation) => void;
};

/** 只组合展示与交互回调，不负责请求或历史上下文。 */
export function ChatMessageList({
  messages,
  hasPublishedSnapshot,
  streaming,
  history,
  onProcessOpen,
  onCitation,
}: ChatMessageListProps) {
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-5 py-8">
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
            title="开始你的知识库对话"
            icon={<MessageSquareIcon className="size-10" />}
            description={
              hasPublishedSnapshot
                ? "可以直接交流，也可以围绕资料连续追问。"
                : "可以先交流；询问知识库内容前请先导入资料。"
            }
          />
        ) : (
          messages.map((message) => (
            <Message from={message.role} key={message.id}>
              {message.role === "assistant" && message.process && (
                <RunProcess
                  process={message.process}
                  onOpenChange={(open) => onProcessOpen(message.id, open)}
                />
              )}
              {(message.role === "user" || message.content) && (
                <MessageContent>
                  {message.role === "assistant" ? (
                    <MessageResponse
                      isAnimating={
                        streaming && message.id === messages.at(-1)?.id
                      }
                    >
                      {message.legacyCitationMarkers
                        ? getVisibleAnswer(
                            message.content,
                            false,
                            message.citations,
                          )
                        : message.content}
                    </MessageResponse>
                  ) : (
                    message.content
                  )}
                </MessageContent>
              )}
              {message.error && (
                <p
                  className={
                    message.process?.status === "interrupted"
                      ? "text-sm text-muted-foreground"
                      : "text-sm text-destructive"
                  }
                  role="status"
                >
                  {message.error}
                </p>
              )}
              {message.role === "assistant" && !!message.citations?.length && (
                <div className="flex flex-wrap gap-2" aria-label="回答来源">
                  <p className="w-full text-xs text-muted-foreground">
                    回答来源
                  </p>
                  {message.citations.map((citation) => (
                    <Button
                      className="h-6 gap-1 px-2 text-xs"
                      disabled={!message.runId}
                      key={citation.id}
                      onClick={() => onCitation(message, citation)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <FileTextIcon className="size-3" />
                      {citation.displayName} · {getCitationLocation(citation)}
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
