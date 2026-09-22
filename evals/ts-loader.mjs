/** 修改时间：2026-09-22 | 文件说明：用 Node 原生 TypeScript 支持加载项目路径别名的离线评测入口 | edit by：Sliye */
import { pathToFileURL } from "node:url";
import path from "node:path";

/**
 * 将项目 @/ 别名解析到源码，不改造生产构建配置。
 * @param {string} specifier 源码中的模块标识。
 * @param {object} context Node 模块解析上下文。
 * @param {Function} nextResolve 后续标准解析器。
 */
export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const source = pathToFileURL(path.join(process.cwd(), `${specifier.slice(2)}.ts`)).href;
    return nextResolve(source, context);
  }
  return nextResolve(specifier, context);
}
