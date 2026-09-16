/** 修改时间：2026-09-16 | 文件说明：聊天输入、提交与停止生成按钮 | edit by：Sliye */
"use client";
import { ArrowUpIcon } from "lucide-react";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";

type ChatComposerProps = {
  value: string;
  disabled: boolean;
  streaming: boolean;
  onChange: (value: string) => void;
  onSubmit: (text: string) => Promise<void>;
  onStop: () => void;
};

/** 输入框复用 AI Elements 的键盘提交行为。 */
export function ChatComposer({
  value,
  disabled,
  streaming,
  onChange,
  onSubmit,
  onStop,
}: ChatComposerProps) {
  return (
    <div className="shrink-0 bg-background px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
      <div className="mx-auto w-full max-w-[47rem]">
        <PromptInput className="chat-composer" onSubmit={({ text }) => onSubmit(text)}>
          <PromptInputTextarea
            aria-label="聊天消息"
            className="min-h-12 py-3.5 pl-5 pr-2 text-base leading-6 md:text-base"
            disabled={disabled || streaming}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
            placeholder="向 VaultAgent 提问"
          />
          <PromptInputSubmit
            className="mr-2 mb-2 size-9 shrink-0 self-end rounded-full"
            aria-label={streaming ? "停止生成" : "发送消息"}
            disabled={!streaming && (disabled || !value.trim())}
            onStop={onStop}
            status={streaming ? "streaming" : "ready"}
          >
            {streaming ? undefined : <ArrowUpIcon className="size-5" />}
          </PromptInputSubmit>
        </PromptInput>
      </div>
    </div>
  );
}
