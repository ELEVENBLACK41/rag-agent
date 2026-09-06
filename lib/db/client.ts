/**
 * 修改时间：2026-09-06 | 文件说明：VaultAgent PostgreSQL 与 Drizzle 客户端 | edit by：Sliye
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

declare global {
  var vaultAgentDatabase: ReturnType<typeof createDatabase> | undefined;
}

/** 为 Route Handler 与 Workflow Step 创建进程内共享的 PostgreSQL 客户端。 */
function createDatabase() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to access VaultAgent data.");
  }

  const client = postgres(connectionString, { max: 5 });
  return drizzle(client, { schema });
}

/** 返回带业务表类型的共享 Drizzle 数据库客户端。 */
export function getDatabase() {
  if (!globalThis.vaultAgentDatabase) {
    globalThis.vaultAgentDatabase = createDatabase();
  }

  return globalThis.vaultAgentDatabase;
}
