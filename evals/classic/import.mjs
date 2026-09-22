/** 修改时间：2026-09-22 | 文件说明：通过现有本地导入 API 将十份固定资料送入隔离评测库 | edit by：Sliye */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { corpusFiles } from "./dataset.mjs";

/** 只接受本机开发服务地址，防止误将固定资料发送至外部部署。 */
const url = new URL(process.argv[2] ?? "http://localhost:3001");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.protocol !== "http:") throw new Error("导入目标必须是本机 HTTP 开发服务。");
/** 以脚本位置确定已生成的固定资料目录。 */
const corpusDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "corpus");
/** 浏览器导入入口要求 MIME；这里只映射固定清单中的格式。 */
const mediaTypes = {
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** @param {string} route 本地导入 API 路径。 @param {RequestInit} options fetch 请求参数。 */
async function request(route, options) {
  const response = await fetch(new URL(route, url), options);
  const body = await response.json();
  if (!response.ok) throw new Error(`导入 API 返回 ${response.status}：${body.error ?? "未知错误"}`);
  return body;
}

/** 导入前要求空资料库，避免误入含其他资料的快照。 */
const current = await request("/api/imports");
if (current.files?.length || current.snapshotId) throw new Error("目标知识库并非空库；请使用新的隔离数据库。");
const form = new FormData();
for (const item of corpusFiles) {
  const bytes = await readFile(path.join(corpusDirectory, item.file));
  const mediaType = mediaTypes[path.extname(item.file)];
  form.append("files", new File([bytes], item.file, { type: mediaType }));
}
form.set("paths", JSON.stringify(corpusFiles.map((item) => item.file)));
const started = await request("/api/imports", { method: "POST", body: form });
console.log(`导入批次 ${started.batchId} 已创建。`);
/** 单批次最多等待十分钟，超过后保留状态供管理端排查。 */
for (let attempt = 0; attempt < 120; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const state = await request(`/api/imports/${started.batchId}`);
  if (attempt % 6 === 0 || ["completed", "failed"].includes(state.status)) console.log(`导入状态：${state.status}，进度 ${state.progressPercent ?? "未知"}%`);
  if (state.status === "failed") throw new Error(`导入失败：${state.errorMessage ?? "查看本地服务日志"}`);
  if (state.status === "completed") {
    const library = await request("/api/imports");
    if (!library.snapshotId) throw new Error("导入标记完成，但未找到已发布快照。");
    console.log(`固定快照：${library.snapshotId}`);
    break;
  }
  if (attempt === 119) throw new Error("导入超过十分钟；批次仍可在本地服务中继续查看。");
}
