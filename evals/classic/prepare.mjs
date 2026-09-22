/** 修改时间：2026-09-22 | 文件说明：将固定事实源生成可导入的脱敏 Markdown 资料 | edit by：Sliye */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { corpusFiles } from "./dataset.mjs";

/** 输出目录便于一次导入；跨格式样本复制字节，不修改源 fixture。 */
const outputDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "corpus");
/** 从当前脚本定位仓库根目录，避免依赖调用时所在目录。 */
const projectDirectory = path.resolve(outputDirectory, "../../..");
await mkdir(outputDirectory, { recursive: true });
for (const item of corpusFiles) {
  if ("content" in item) await writeFile(path.join(outputDirectory, item.file), item.content, "utf8");
  else await copyFile(path.join(projectDirectory, item.source), path.join(outputDirectory, item.file));
}
console.log(`已准备 ${corpusFiles.length} 个固定资料。`);
