/**
 * 修改时间：2026-09-15 | 文件说明：VaultAgent 知识库聊天入口 | edit by：Sliye
 */

import { VaultWorkspace } from "@/components/chat/vault-workspace";
import { LOCAL_WORKSPACE_ID } from "@/lib/ingestion/imports";
import { getLatestPublishedSnapshot } from "@/lib/retrieval/search";

export const dynamic = "force-dynamic";

/** 使用服务端当前已发布快照决定聊天是否可用。 */
export default async function Home() {
  const snapshot = await getLatestPublishedSnapshot(LOCAL_WORKSPACE_ID);
  return <VaultWorkspace canChat={Boolean(snapshot)} />;
}
