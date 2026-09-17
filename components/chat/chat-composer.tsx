/** 修改时间：2026-09-17 | 文件说明：聊天输入、联网开关、提交与停止生成按钮 | edit by：Sliye */
"use client";
import { ArrowUpIcon, GlobeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";

type ChatComposerProps = {
  value: string;
  disabled: boolean;
  streaming: boolean;
  webSearchEnabled: boolean;
  onWebSearchChange: (enabled: boolean) => void;
  onChange: (value: string) => void;
  onSubmit: (text: string) => Promise<void>;
  onStop: () => void;
};

/** 输入框复用 AI Elements 的键盘提交行为。 */
export function ChatComposer({
  value,
  disabled,
  streaming,
  webSearchEnabled,
  onWebSearchChange,
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
            className="min-h-12 py-3.5 px-5 text-base leading-6 md:text-base"
            disabled={disabled || streaming}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
            placeholder="向 VaultAgent 提问"
          />
          <PromptInputFooter className="px-3 pb-3 pt-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={webSearchEnabled
                ? "rounded-full bg-link/10 text-link hover:bg-link/15 hover:text-link"
                : "rounded-full text-muted-foreground"}
              aria-pressed={webSearchEnabled}
              title="允许本轮按需搜索公开信息，仅发送必要查询关键词"
              disabled={disabled || streaming}
              onClick={() => onWebSearchChange(!webSearchEnabled)}
            >
              <GlobeIcon className="size-3.5" />
              联网搜索{webSearchEnabled ? " · 已开启" : ""}
            </Button>
            <PromptInputSubmit
              className="size-9 shrink-0 rounded-full"
              aria-label={streaming ? "停止生成" : "发送消息"}
              disabled={!streaming && (disabled || !value.trim())}
              onStop={onStop}
              status={streaming ? "streaming" : "ready"}
            >
              {streaming ? undefined : <ArrowUpIcon className="size-5" />}
            </PromptInputSubmit>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
