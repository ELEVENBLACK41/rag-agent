/**
 * 修改时间：2026-09-07 | 文件说明：VaultAgent D2-D3 核心业务数据表定义 | edit by：Sliye
 */

import {
  bigint,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/** 以 pgvector 存储 Gateway 固定输出的 1024 维向量。 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector(1024)",
  toDriver: (value) => `[${value.join(",")}]`,
  fromDriver: (value) =>
    value
      .slice(1, -1)
      .split(",")
      .filter(Boolean)
      .map(Number),
});

export const workspaces = pgTable("workspaces", {
  id: varchar("id", { length: 64 }).primaryKey(),
  mode: varchar("mode", { length: 16 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const principals = pgTable(
  "principals",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 64 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("principals_workspace_id_idx").on(table.workspaceId)],
);

export const logicalFiles = pgTable(
  "logical_files",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 64 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("logical_files_workspace_id_idx").on(table.workspaceId)],
);

export const fileVersions = pgTable(
  "file_versions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    logicalFileId: varchar("logical_file_id", { length: 64 })
      .notNull()
      .references(() => logicalFiles.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    mediaType: varchar("media_type", { length: 127 }).notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("file_versions_logical_file_version_uq").on(
      table.logicalFileId,
      table.versionNumber,
    ),
    index("file_versions_content_hash_idx").on(table.contentHash),
  ],
);

export const indexSnapshots = pgTable(
  "index_snapshots",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 64 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [index("index_snapshots_workspace_id_idx").on(table.workspaceId)],
);

export const imports = pgTable(
  "imports",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 64 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    fileVersionId: varchar("file_version_id", { length: 64 })
      .notNull()
      .references(() => fileVersions.id, { onDelete: "cascade" }),
    snapshotId: varchar("snapshot_id", { length: 64 })
      .notNull()
      .references(() => indexSnapshots.id, { onDelete: "cascade" }),
    workflowRunId: varchar("workflow_run_id", { length: 255 }),
    status: varchar("status", { length: 16 }).notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("imports_workspace_status_idx").on(table.workspaceId, table.status)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    fileVersionId: varchar("file_version_id", { length: 64 })
      .notNull()
      .references(() => fileVersions.id, { onDelete: "cascade" }),
    snapshotId: varchar("snapshot_id", { length: 64 })
      .notNull()
      .references(() => indexSnapshots.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    embedding: vector("embedding"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("chunks_file_version_ordinal_uq").on(
      table.fileVersionId,
      table.ordinal,
    ),
    index("chunks_snapshot_id_idx").on(table.snapshotId),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 64 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("conversations_workspace_id_idx").on(table.workspaceId)],
);

/**
 * 对话消息与 Run 分离保存。助手消息的 citations 保存真实 Chunk 定位信息，供引用抽屉在后续阶段扩展。
 */
export const messages = pgTable(
  "messages",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    conversationId: varchar("conversation_id", { length: 64 })
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    runId: varchar("run_id", { length: 64 }),
    role: varchar("role", { length: 16 }).notNull(),
    content: text("content").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    citations: jsonb("citations").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("messages_conversation_id_idx").on(table.conversationId),
    index("messages_run_id_idx").on(table.runId),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    conversationId: varchar("conversation_id", { length: 64 })
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    snapshotId: varchar("snapshot_id", { length: 64 })
      .notNull()
      .references(() => indexSnapshots.id),
    status: varchar("status", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("runs_conversation_id_idx").on(table.conversationId)],
);

export const runEvents = pgTable(
  "run_events",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    runId: varchar("run_id", { length: 64 })
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    eventType: varchar("event_type", { length: 32 }).notNull(),
    stepId: varchar("step_id", { length: 128 }),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("run_events_run_sequence_uq").on(table.runId, table.sequence),
    index("run_events_run_id_idx").on(table.runId),
  ],
);
