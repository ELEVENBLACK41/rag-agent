/** 修改时间：2026-09-17 | 文件说明：版本化离线评测报告的所有者读取与格式校验 | edit by：Sliye */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { isOwner } from "@/lib/auth/owner";

/** 固定目录，D15 执行器写入；请求不能指定磁盘路径。 */
const REPORT_DIRECTORY = path.join(process.cwd(), "evals", "reports");
/** 安全的报告文件名。 */
export const reportIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
/** 未评分为 null，不能以零代替；评分来源、分子分母与版本都显式保存。 */
export const evaluationReportSchema = z.object({
  version: z.literal("evaluation-report-v1"),
  id: reportIdSchema,
  createdAt: z.string().datetime(),
  datasetVersion: z.string().min(1),
  corpusHash: z.string().min(1),
  scorerVersion: z.string().min(1),
  configurationHash: z.string().min(1),
  promptHash: z.string().min(1),
  cases: z
    .array(
      z.object({
        id: z.string().min(1),
        runId: z.string().uuid().nullable(),
        status: z.enum(["passed", "failed", "unscored", "not-applicable"]),
        metrics: z.record(
          z.string(),
          z.object({
            value: z.number().nullable(),
            numerator: z.number().nullable(),
            denominator: z.number().nullable(),
            unit: z.string(),
            source: z.enum(["deterministic", "human", "model"]),
          }),
        ),
        explanation: z.string().max(4000),
      }),
    )
    .max(1000),
});

/** @param id 报告标识。大小和格式错误显式失败，不伪装为空报告。 */
export async function readEvaluationReport(id: string) {
  if (!(await isOwner())) throw new Error("需要所有者身份。");
  const filename = path.join(
    REPORT_DIRECTORY,
    `${reportIdSchema.parse(id)}.json`,
  );
  try {
    if ((await stat(filename)).size > 2_000_000)
      throw new Error("报告超过读取上限。");
    const report = evaluationReportSchema.parse(
      JSON.parse(await readFile(filename, "utf8")),
    );
    if (report.id !== id) throw new Error("报告标识与文件名不一致。");
    return report;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}

/** 按文件名降序读取最多 50 个报告，超限显式提示。 */
export async function listEvaluationReports() {
  if (!(await isOwner())) throw new Error("需要所有者身份。");
  let filenames: string[];
  try {
    filenames = await readdir(REPORT_DIRECTORY);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { reports: [], truncated: false };
    throw error;
  }
  const ids = filenames
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5))
    .filter((id) => reportIdSchema.safeParse(id).success)
    .sort()
    .reverse();
  const reports = await Promise.all(ids.slice(0, 50).map(readEvaluationReport));
  return {
    reports: reports.filter((report) => report !== null),
    truncated: ids.length > 50,
  };
}
