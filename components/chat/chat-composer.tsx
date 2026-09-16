/** 修改时间：2026-09-16 | 文件说明：聊天输入、提交与停止接收按钮 | edit by：Sliye */
"use client";
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
    <div className="border-t border-border bg-card px-5 py-4">
      <div className="mx-auto w-full max-w-3xl">
        <PromptInput onSubmit={({ text }) => onSubmit(text)}>
          <PromptInputTextarea
            aria-label="聊天消息"
            disabled={disabled || streaming}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
            placeholder="问问你的资料，或继续追问…"
          />
          <PromptInputSubmit
            aria-label={streaming ? "停止接收" : "发送消息"}
            disabled={!streaming && (disabled || !value.trim())}
            onStop={onStop}
            status={streaming ? "streaming" : "ready"}
          />
        </PromptInput>
      </div>
    </div>
  );
}
