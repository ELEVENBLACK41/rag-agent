/**
 * 修改时间：2026-09-11 | 文件说明：VaultAgent 核心业务数据表定义 | edit by：Sliye
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
    /** Vault 内用于识别同一逻辑文件的相对路径。旧 D3 数据为空。 */
    sourcePath: varchar("source_path", { length: 1_024 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("logical_files_workspace_id_idx").on(table.workspaceId),
    index("logical_files_workspace_path_idx").on(table.workspaceId, table.sourcePath),
  ],
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

/** 一次多文件或 ZIP 提交对应一个导入批次，并只在完整就绪后发布候选快照。 */
export const importBatches = pgTable(
  "import_batches",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 64 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    snapshotId: varchar("snapshot_id", { length: 64 })
      .notNull()
      .references(() => indexSnapshots.id, { onDelete: "cascade" }),
    workflowRunId: varchar("workflow_run_id", { length: 255 }),
    status: varchar("status", { length: 16 }).notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("import_batches_workspace_status_idx").on(table.workspaceId, table.status)],
);

/** 不可变快照显式记录可参与检索的文件版本，避免 D3 的“最新文件覆盖旧文件”问题。 */
export const indexSnapshotFiles = pgTable(
  "index_snapshot_files",
  {
    snapshotId: varchar("snapshot_id", { length: 64 })
      .notNull()
      .references(() => indexSnapshots.id, { onDelete: "cascade" }),
    fileVersionId: varchar("file_version_id", { length: 64 })
      .notNull()
      .references(() => fileVersions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("index_snapshot_files_snapshot_version_uq").on(table.snapshotId, table.fileVersionId),
    index("index_snapshot_files_version_idx").on(table.fileVersionId),
  ],
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
    batchId: varchar("batch_id", { length: 64 }).references(() => importBatches.id, {
      onDelete: "cascade",
    }),
    workflowRunId: varchar("workflow_run_id", { length: 255 }),
    status: varchar("status", { length: 16 }).notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("imports_workspace_status_idx").on(table.workspaceId, table.status)],
);

/** 一条解析诊断绑定到具体导入记录，可表达 PDF 页级警告而不污染 Chunk 正文。 */
export const importDiagnostics = pgTable(
  "import_diagnostics",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    importId: varchar("import_id", { length: 64 })
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    severity: varchar("severity", { length: 16 }).notNull(),
    stage: varchar("stage", { length: 16 }).notNull(),
    pageNumber: integer("page_number"),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("import_diagnostics_import_id_idx").on(table.importId),
    index("import_diagnostics_import_page_idx").on(
      table.importId,
      table.pageNumber,
    ),
  ],
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
    /** PDF 没有稳定行号，物理页码保存在 sourceLocator。 */
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    /** 标题路径、Block ID 及链接/附件目标，供可复现引用和后续原文抽屉使用。 */
    sourceLocator: jsonb("source_locator").notNull().default({}),
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
