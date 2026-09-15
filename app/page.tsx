/**
 * 修改时间：2026-09-16 | 文件说明：VaultAgent 知识库聊天入口 | edit by：Sliye
 */

import { VaultWorkspace } from "@/components/chat/vault-workspace";
import { LOCAL_WORKSPACE_ID } from "@/lib/ingestion/imports";
import { getLatestPublishedSnapshot } from "@/lib/retrieval/search";

export const dynamic = "force-dynamic";

/** 当前快照只用于空库提示，普通交流始终可用。 */
export default async function Home() {
  const snapshot = await getLatestPublishedSnapshot(LOCAL_WORKSPACE_ID);
  return <VaultWorkspace hasPublishedSnapshot={Boolean(snapshot)} />;
}
