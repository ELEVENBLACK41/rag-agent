/**
 * 修改时间：2026-09-06 | 文件说明：启动本地 PostgreSQL Workflow World | edit by：Sliye
 */

/** Starts the durable local Workflow worker only in a Node.js runtime. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getWorld } = await import("workflow/runtime");
    await getWorld().start?.();
  }
}
