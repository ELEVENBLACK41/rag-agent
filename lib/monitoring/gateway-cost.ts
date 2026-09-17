/** 修改时间：2026-09-17 | 文件说明：读取 Gateway 返回的单步费用，缺失或无效金额不作为零 | edit by：Sliye */
import { z } from "zod";

/** Gateway 金额可能是十进制字符串；拒绝空白、布尔、负数及非有限值。 */
const amountSchema = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
      .transform(Number),
  ])
  .pipe(z.number().finite().nonnegative());
/** 只读取费用与请求标识，不保存其他供应商元数据。 */
const metadataSchema = z.object({
  gateway: z.object({
    cost: z.unknown().optional(),
    generationId: z.unknown().optional(),
  }),
});

/**
 * 官方：https://examples.vercel.com/academy/ai-gateway/ai-gateway-pricing
 * cost 为 Gateway 返回的 USD 金额；不再叠加推理、缓存或其他费用子项。
 * @param metadata 当前模型步骤的 providerMetadata，不使用整轮累计结果重复计费。
 */
export function readGatewayCost(metadata: unknown) {
  const parsed = metadataSchema.safeParse(metadata);
  const gateway = parsed.success ? parsed.data.gateway : undefined;
  const amount = amountSchema.safeParse(gateway?.cost);
  const generationId = z
    .string()
    .min(1)
    .max(255)
    .safeParse(gateway?.generationId);
  return {
    costUsd: amount.success ? amount.data : null,
    costSource: amount.success ? "gateway-response" : null,
    costStatus: amount.success
      ? "reported"
      : gateway?.cost == null
        ? "missing"
        : "invalid",
    gatewayGenerationId: generationId.success ? generationId.data : null,
  };
}

/** @param value 已验证的美元金额；保留小额调用精度，并区分真实零和未知。 */
export function formatUsd(value: number | null | undefined) {
  if (value == null) return "未采集";
  if (value > 0 && value < 0.00000001) return "<$0.00000001";
  return `$${value.toFixed(8)}`;
}
