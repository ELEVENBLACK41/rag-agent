/**
 * 修改时间：2026-09-11 | 文件说明：VaultAgent 通用图片视觉分析入口 | edit by：Sliye
 */

import { generateText, gateway, Output } from "ai";
import { z } from "zod";
import type { VisualAnalysis } from "@/lib/ingestion/visual/types";

/** 所有格式复用的视觉模型与提示词版本。 */
export const VISUAL_MODEL = "alibaba/qwen3.7-flash";
export const VISUAL_PROMPT_VERSION = "image-analysis-v1";

const visualAnalysisSchema = z.object({
  description: z.string().min(1).max(1_500),
  visibleText: z.string().max(1_000),
  confidence: z.enum(["high", "medium", "low"]),
});

/**
 * 对受限图片字节生成结构化描述。调用方负责选择图片、限额与结果持久化。
 *
 * @param image 图片原始字节。
 * @param mediaType 图片 MIME 类型。
 */
export async function analyzeImage(
  image: Uint8Array,
  mediaType: "image/png" | "image/jpeg",
): Promise<VisualAnalysis> {
  if (!process.env.AI_GATEWAY_API_KEY)
    throw new Error("AI_GATEWAY_API_KEY is required before visual analysis.");
  const { output } = await generateText({
    model: gateway(VISUAL_MODEL),
    output: Output.object({ schema: visualAnalysisSchema }),
    reasoning: "none",
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text: "仅描述图片中可见内容和可辨认文字；不要推断图片外的事实。",
        },
        { type: "file", data: image, mediaType },
      ],
    }],
  });
  return output;
}
