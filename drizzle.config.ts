/**
 * 修改时间：2026-09-06 | 文件说明：VaultAgent Drizzle PostgreSQL 迁移配置 | edit by：Sliye
 */

import { defineConfig } from "drizzle-kit";

/** 本地默认值与 compose.yaml 一致，仅由本地迁移命令使用。 */
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://vaultagent:vaultagent_dev@localhost:5433/vaultagent";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl },
});
