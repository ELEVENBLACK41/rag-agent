/**
 * 修改时间：2026-09-06 | 文件说明：启动本地 PostgreSQL Workflow World | edit by：Sliye
 */

/** 仅在 Node.js Runtime 中启动本地持久化 Workflow Worker。 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getWorld } = await import("workflow/runtime");
    await getWorld().start?.();
  }
}
