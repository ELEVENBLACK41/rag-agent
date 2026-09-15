/**
 * 修改时间：2026-09-15
 * 文件说明：VaultAgent 单次 Run 的公开执行过程折叠面板。
 * edit by：Sliye
 */

"use client";

import { useEffect, useState } from "react";
import { CheckCircle2Icon, CircleDashedIcon, XCircleIcon } from "lucide-react";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";

export type RunProcessEvent =
  | {
      id: string;
      kind: "stage";
      message: string;
      status: "active" | "complete";
    }
  | {
      id: string;
      kind: "tool";
      message: string;
      status: "started" | "completed" | "failed";
    };

export type RunProcessState = {
  status: "running" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
  open: boolean;
  events: RunProcessEvent[];
};

type RunProcessProps = {
  process: RunProcessState;
  onOpenChange: (open: boolean) => void;
};

/** 展示按真实事件顺序排列的公开阶段说明和工具活动。 */
export function RunProcess({ process, onOpenChange }: RunProcessProps) {
  const elapsedSeconds = useElapsedSeconds(process);

  return (
    <ChainOfThought
      className="border-b border-border pb-4"
      onOpenChange={onOpenChange}
      open={process.open}
    >
      <ChainOfThoughtHeader className="[&>svg:first-child]:hidden">
        {getProcessLabel(process.status, elapsedSeconds)}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent className="space-y-4 pt-2">
        {process.events.map((event) =>
          event.kind === "stage" ? (
            <div className="pl-6" key={event.id}>
              <MessageResponse
                className="text-sm leading-6 text-foreground"
                isAnimating={true}
              >
                {event.message}
              </MessageResponse>
            </div>
          ) : (
            <ChainOfThoughtStep
              icon={getToolIcon(event.status)}
              key={event.id}
              label={
                event.status === "started" ? (
                  <Shimmer
                    as="span"
                    className="text-sm"
                    duration={1.8}
                    spread={1.5}
                  >
                    {event.message}
                  </Shimmer>
                ) : (
                  event.message
                )
              }
              status={event.status === "started" ? "active" : "complete"}
            />
          ),
        )}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

/** 运行期间更新耗时，完成后固定在服务端事件到达的时间点。 */
function useElapsedSeconds(process: RunProcessState) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (process.status !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [process.status]);

  return Math.max(
    0,
    Math.floor(((process.completedAt ?? now) - process.startedAt) / 1_000),
  );
}

/** 将 Run 状态和耗时转换为折叠标题。 */
function getProcessLabel(status: RunProcessState["status"], elapsedSeconds: number) {
  const duration = formatDuration(elapsedSeconds);
  if (status === "running") return `正在执行 · 已用时 ${duration}`;
  if (status === "failed") return `执行失败 · 用时 ${duration}`;
  return `用时 ${duration}`;
}

/** 以分秒格式显示真实耗时。 */
function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

/** 根据公开工具状态选择图标，不展示模型参数和原始输出。 */
function getToolIcon(status: Extract<RunProcessEvent, { kind: "tool" }>["status"]) {
  if (status === "completed") return CheckCircle2Icon;
  if (status === "failed") return XCircleIcon;
  return CircleDashedIcon;
}
