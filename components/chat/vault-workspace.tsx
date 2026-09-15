/**
 * 修改时间：2026-09-15
 * 文件说明：VaultAgent D9 知识库聊天工作台。
 *
 * 页面组合导入面板、Agent 公开工具活动、聊天流和可点击引用；来源正文由右侧
 * 抽屉通过 Run 范围的受鉴权 API 读取，避免前端直接接触存储信息。
 *
 * edit by：Sliye
 */

"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  RunProcess,
  type RunProcessEvent,
  type RunProcessState,
} from "@/components/chat/run-process";
import { SourceDrawer } from "@/components/sources/source-drawer";
import { BookOpenIcon, FileTextIcon, MessageSquareIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { SourceCitation } from "@/lib/sources/types";

type Citation = SourceCitation;

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  runId?: string;
  citations?: Citation[];
  process?: RunProcessState;
};

type ToolActivity = {
  toolCallId: string;
  toolName: string;
  status: "started" | "completed" | "failed";
  message: string;
};

type VaultWorkspaceProps = {
  canChat: boolean;
};

/** 本地聊天工作台：使用当前已发布知识库快照进行问答并展示引用。 */
export function VaultWorkspace({ canChat }: VaultWorkspaceProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(
    null,
  );
  const [selectedSourceRunId, setSelectedSourceRunId] = useState<string | null>(
    null,
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  /** 发起单轮问答并把 SSE 文本增量写入临时助手消息。 */
  async function submitQuestion(message: PromptInputMessage) {
    const question = message.text.trim();
    if (!question || !canChat || isStreaming) return;

    const assistantMessageId = crypto.randomUUID();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: question },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        process: createRunningProcess(),
      },
    ]);
    setInput("");
    setChatError(null);
    setIsStreaming(true);

    let activeRunId: string | null = null;
    let completed = false;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, conversationId }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? "无法开始知识问答。");
      }

      await consumeSse(response.body, (event, data) => {
        if (event === "run") {
          const run = data as { runId?: string; conversationId?: string };
          activeRunId = run.runId ?? null;
          if (run.conversationId) setConversationId(run.conversationId);
          if (run.runId) updateAssistantRunId(assistantMessageId, run.runId);
        }
        if (event === "stage") {
          appendProcessStage(
            assistantMessageId,
            (data as { message: string }).message,
          );
        }
        if (event === "tool") {
          updateToolActivity(assistantMessageId, data as ToolActivity);
        }
        if (event === "delta")
          appendAssistantText(
            assistantMessageId,
            (data as { text: string }).text,
          );
        if (event === "complete") {
          updateAssistantCitations(
            assistantMessageId,
            (data as { citations: Citation[] }).citations,
          );
          completed = true;
          completeProcess(assistantMessageId);
        }
        if (event === "error")
          throw new Error((data as { message: string }).message);
      });

      if (!completed && activeRunId)
        await replayRunEvents(activeRunId, assistantMessageId);
    } catch (error) {
      failProcess(assistantMessageId);
      setChatError(
        error instanceof DOMException && error.name === "AbortError"
          ? "已停止接收回答；刷新后可通过持久化事件补齐状态。"
          : toErrorMessage(error),
      );
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  }

  /** 连接中断后，以 Run 事件还原已持久化的回答文本。 */
  async function replayRunEvents(runId: string, assistantMessageId: string) {
    const response = await fetch(`/api/runs/${runId}/events?after=0`, {
      cache: "no-store",
    });
    if (!response.ok || !response.body)
      throw new Error("无法补齐断线期间的任务事件。");

    let recoveredText = "";
    await consumeSse(response.body, (event, data) => {
      if (event !== "replay") return;
      const replay = data as {
        eventType: string;
        payload: Record<string, unknown>;
      };
      if (replay.eventType === "final_delta")
        recoveredText += String(replay.payload.text ?? "");
      if (replay.eventType === "stage_message") {
        appendProcessStage(
          assistantMessageId,
          String(replay.payload.message ?? "正在恢复任务状态。"),
        );
      }
      if (
        replay.eventType === "tool_started" ||
        replay.eventType === "tool_finished"
      ) {
        updateToolActivity(assistantMessageId, replay.payload as ToolActivity);
      }
      if (replay.eventType === "run_completed") {
        updateAssistantCitations(
          assistantMessageId,
          (replay.payload.citations as Citation[]) ?? [],
        );
        completeProcess(assistantMessageId);
      }
      if (replay.eventType === "run_failed") failProcess(assistantMessageId);
    });
    if (recoveredText) replaceAssistantText(assistantMessageId, recoveredText);
  }

  /** 软删除当前会话，不会删除已导入的知识库文件。 */
  async function removeConversation() {
    if (!conversationId || isStreaming) return;
    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      return setChatError(result.error ?? "无法删除会话。");
    }
    startNewConversation();
  }

  /** 清空当前页面会话，下一次提问会新建持久化会话。 */
  function startNewConversation() {
    setConversationId(null);
    setMessages([]);
    setChatError(null);
    setSelectedCitation(null);
    setSelectedSourceRunId(null);
  }

  /** 将服务端文本增量追加到对应的助手消息。 */
  function appendAssistantText(messageId: string, text: string) {
    setMessages((current) =>
      current.map((item) => {
        if (item.id !== messageId) return item;
        const isFirstFinalDelta = !item.content;
        return {
          ...item,
          content: item.content + text,
          process:
            isFirstFinalDelta && item.process
              ? finishProcess(item.process, false)
              : item.process,
        };
      }),
    );
  }

  /** 使用断线补齐的完整内容替换临时助手消息，防止内容重复。 */
  function replaceAssistantText(messageId: string, text: string) {
    setMessages((current) =>
      current.map((item) =>
        item.id === messageId
          ? {
              ...item,
              content: text,
              process: item.process
                ? finishProcess(item.process, false)
                : item.process,
            }
          : item,
      ),
    );
  }

  /** 更新助手消息的真实文档行号引用。 */
  function updateAssistantCitations(messageId: string, citations: Citation[]) {
    setMessages((current) =>
      current.map((item) =>
        item.id === messageId ? { ...item, citations } : item,
      ),
    );
  }

  /** 将服务端新建的 Run 绑定到临时助手消息，引用抽屉只能使用这一真实 Run。 */
  function updateAssistantRunId(messageId: string, runId: string) {
    setMessages((current) =>
      current.map((item) =>
        item.id === messageId ? { ...item, runId } : item,
      ),
    );
  }

  /** 同一个工具调用更新一行公开状态，不渲染模型参数、工具输出或私密思维。 */
  function updateToolActivity(messageId: string, activity: ToolActivity) {
    updateMessageProcess(messageId, (process) => {
      const previous = process.events.findIndex(
        (event) => event.kind === "tool" && event.id === activity.toolCallId,
      );
      const toolEvent: RunProcessEvent = {
        id: activity.toolCallId,
        kind: "tool",
        message: activity.message,
        status: activity.status,
      };
      const events =
        previous < 0
          ? [...process.events, toolEvent]
          : process.events.map((event, index) =>
              index === previous ? toolEvent : event,
            );
      return { ...process, events };
    });
  }

  /** 追加一条公开阶段说明，并完成上一条活跃阶段。 */
  function appendProcessStage(messageId: string, message: string) {
    updateMessageProcess(messageId, (process) => ({
      ...process,
      events: [
        ...completeActiveStages(process.events),
        { id: crypto.randomUUID(), kind: "stage", message, status: "active" },
      ],
    }));
  }

  /** 最终结果开始或 Run 完成后，执行过程默认折叠。 */
  function completeProcess(messageId: string) {
    updateMessageProcess(messageId, (process) => finishProcess(process, false));
  }

  /** 失败过程保持展开，确保用户能看到停止位置。 */
  function failProcess(messageId: string) {
    updateMessageProcess(messageId, (process) => ({
      ...finishProcess(process, true),
      status: "failed",
    }));
  }

  /** 更新指定助手消息自己的 Run 展示状态，避免后续消息覆盖旧过程。 */
  function updateMessageProcess(
    messageId: string,
    update: (process: RunProcessState) => RunProcessState,
  ) {
    setMessages((current) =>
      current.map((item) =>
        item.id === messageId && item.process
          ? { ...item, process: update(item.process) }
          : item,
      ),
    );
  }

  /** 打开引用时固定其所属 Run，防止新一轮问答覆盖来源上下文。 */
  function openCitation(message: ChatMessage, citation: Citation) {
    if (!message.runId) return;
    setSelectedCitation(citation);
    setSelectedSourceRunId(message.runId);
  }

  return (
    <main className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside className="hidden w-80 shrink-0 border-r border-border bg-card lg:block">
        <div className="flex h-full flex-col gap-5 p-5">
          <div className="space-y-1">
            <p className="text-lg font-semibold">VaultAgent</p>
            <p className="text-sm text-muted-foreground">多格式知识问答</p>
          </div>
          <Button
            className="w-full"
            onClick={startNewConversation}
            type="button"
            variant="outline"
          >
            <PlusIcon className="size-4" /> 新建会话
          </Button>
          <Separator />
          <Button asChild className="w-full" variant="ghost">
            <Link href="/library">
              <BookOpenIcon className="size-4" /> 管理知识库
            </Link>
          </Button>
          <p className="mt-auto text-xs leading-5 text-muted-foreground">
            删除会话不会删除知识库文件；删除文件会发布不含该文件的新快照。
          </p>
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h1 className="font-semibold">我的知识库</h1>
            <p className="text-sm text-muted-foreground">
              单轮真实检索、流式回答与来源定位引用
            </p>
          </div>
          <Button asChild className="lg:hidden" size="sm" variant="outline">
            <Link href="/library">
              <BookOpenIcon className="size-4" /> 知识库
            </Link>
          </Button>
          {conversationId && (
            <Button
              disabled={isStreaming}
              onClick={removeConversation}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trash2Icon className="size-4" /> 删除会话
            </Button>
          )}
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          <Conversation className="min-h-0 flex-1">
            <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-5 py-8">
              {messages.length === 0 ? (
                <ConversationEmptyState
                  description={
                    canChat
                      ? "输入问题，VaultAgent 会检索已导入资料并给出可回溯引用。"
                      : "请先导入并完成一批可索引文件的导入。"
                  }
                  icon={<MessageSquareIcon className="size-10" />}
                  title="开始你的知识库对话"
                />
              ) : (
                messages.map((message) => (
                  <Message from={message.role} key={message.id}>
                    {message.role === "assistant" && message.process && (
                      <RunProcess
                        onOpenChange={(open) =>
                          updateMessageProcess(message.id, (process) =>
                            process.status === "running"
                              ? process
                              : { ...process, open },
                          )
                        }
                        process={message.process}
                      />
                    )}
                    {(message.role === "user" || message.content) && (
                      <MessageContent>
                        {message.role === "assistant" ? (
                          <MessageResponse
                            isAnimating={
                              isStreaming && message.id === messages.at(-1)?.id
                            }
                          >
                            {message.content}
                          </MessageResponse>
                        ) : (
                          message.content
                        )}
                      </MessageContent>
                    )}
                    {message.role === "assistant" &&
                      message.citations &&
                      message.citations.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {message.citations.map((citation) => (
                            <Button
                              className="h-6 gap-1 px-2 text-xs"
                              disabled={!message.runId}
                              key={citation.id}
                              onClick={() => openCitation(message, citation)}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              <FileTextIcon className="size-3" />【{citation.id}
                              】{citation.displayName} ·{" "}
                              {getCitationLocation(citation)}
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
          <div className="border-t border-border bg-card px-5 py-4">
            <div className="mx-auto w-full max-w-3xl space-y-2">
              {chatError && (
                <p className="text-sm text-destructive" role="alert">
                  {chatError}
                </p>
              )}
              <PromptInput onSubmit={submitQuestion}>
                <PromptInputTextarea
                  disabled={!canChat || isStreaming}
                  onChange={(event) => setInput(event.currentTarget.value)}
                  placeholder={
                    canChat
                      ? "问问你的已导入资料…"
                      : "完成 Markdown 索引后即可提问"
                  }
                  value={input}
                />
                <PromptInputSubmit
                  disabled={!canChat || (!input.trim() && !isStreaming)}
                  onStop={() => abortControllerRef.current?.abort()}
                  status={isStreaming ? "streaming" : "ready"}
                />
              </PromptInput>
            </div>
          </div>
        </div>
      </section>
      <SourceDrawer
        citation={selectedCitation}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedCitation(null);
            setSelectedSourceRunId(null);
          }
        }}
        runId={selectedSourceRunId}
      />
    </main>
  );
}

/** 将不同格式的来源定位转为聊天引用标签，历史行号引用继续可读。 */
function getCitationLocation(citation: Citation) {
  if (citation.sourceLocator?.format === "pdf" && citation.sourceLocator.pageNumber)
    return `第 ${citation.sourceLocator.pageNumber} 页`;
  if (citation.sourceLocator?.format === "pdf-visual" && citation.sourceLocator.pageNumber)
    return `第 ${citation.sourceLocator.pageNumber} 页 · 视觉分析`;
  if (citation.sourceLocator?.format === "docx") {
    const block = citation.sourceLocator.blockType === "table"
      ? `表格 ${citation.sourceLocator.tableIndex ?? citation.sourceLocator.blockIndex ?? ""}`
      : `段落 ${citation.sourceLocator.blockIndex ?? ""}`;
    return block.trim();
  }
  if (citation.sourceLocator?.format === "docx-visual" && citation.sourceLocator.imageIndex)
    return `内嵌图片 ${citation.sourceLocator.imageIndex} · 视觉分析`;
  if (citation.sourceLocator?.format === "xlsx" && citation.sourceLocator.sheetName && citation.sourceLocator.range)
    return `工作表 ${citation.sourceLocator.sheetName} · ${citation.sourceLocator.range}`;
  if (citation.sourceLocator?.format === "xlsx-visual" && citation.sourceLocator.sheetName && citation.sourceLocator.anchor && citation.sourceLocator.imageIndex)
    return `工作表 ${citation.sourceLocator.sheetName} · ${citation.sourceLocator.anchor} · 内嵌图片 ${citation.sourceLocator.imageIndex} · 视觉分析`;
  if (citation.startLine !== null && citation.endLine !== null)
    return `${citation.startLine}-${citation.endLine} 行`;
  return "位置不可用";
}

/** 读取 SSE 响应中的 event/data 帧。 */
async function consumeSse(stream: ReadableStream<Uint8Array>, onEvent: (event: string, data: unknown) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = frame.match(/^event: (.+)$/m)?.[1] ?? "message";
      const data = frame.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
      if (data) onEvent(event, JSON.parse(data));
      boundary = buffer.indexOf("\n\n");
    }
  }
}

/** 将未知异常转换为用户可见的简短错误消息。 */
function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "发生未知错误，请稍后重试。";
}

/** 创建只绑定当前助手消息的运行中过程状态 不应该把正在思考写进流事件里面*/
function createRunningProcess(): RunProcessState {
  return {
    status: "running",
    startedAt: Date.now(),
    open: true,
    // events: [{
    //   id: crypto.randomUUID(),
    //   kind: "stage",
    //   message: "正在思考",
    //   status: "active",
    // }],
    events: []
  };
}

/** 把当前活跃阶段改为已完成，保持事件原始顺序。 */
function completeActiveStages(events: RunProcessEvent[]) {
  return events.map((event) => (
    event.kind === "stage" && event.status === "active"
      ? { ...event, status: "complete" as const }
      : event
  ));
}

/** 固定执行过程耗时；成功默认折叠，失败保持展开。 */
function finishProcess(process: RunProcessState, open: boolean): RunProcessState {
  return {
    ...process,
    status: process.status === "failed" ? "failed" : "completed",
    completedAt: process.completedAt ?? Date.now(),
    open,
    events: completeActiveStages(process.events),
  };
}
