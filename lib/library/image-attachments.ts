/** 修改时间：2026-09-17 | 文件说明：当前已发布知识库图片附件的分页清单与受控读取 | edit by：Sliye */
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { fileVersions } from "@/lib/db/schema";
import { getCurrentLibraryFiles } from "@/lib/ingestion/imports";
import { readStoredFile } from "@/lib/storage/files";

/** 单次向浏览器发送的图片元数据上限，不读取图片字节。 */
const IMAGE_PAGE_SIZE = 24;

/**
 * 复用知识库的最新路径去重规则，防止列表和图片版本不一致。
 * @param offset 已校验的非负分页偏移。
 * @param snapshotId 后续分页固定的快照；变更时要求刷新，避免跨版本拼接。
 */
export async function listImageAttachments(
  offset: number,
  snapshotId?: string,
) {
  const library = await getCurrentLibraryFiles();
  if (snapshotId && snapshotId !== library.snapshotId) return null;
  const images = library.files.filter(
    (file) => file.mediaType === "image/png" || file.mediaType === "image/jpeg",
  );
  const items = images.slice(offset, offset + IMAGE_PAGE_SIZE).map((file) => ({
    id: file.fileVersionId,
    importId: file.id,
    name: file.sourcePath ?? file.displayName,
    version: file.versionNumber,
    byteSize: file.byteSize,
    url: `/api/attachments/${encodeURIComponent(file.fileVersionId)}?snapshotId=${encodeURIComponent(library.snapshotId!)}`,
  }));
  return {
    items,
    snapshotId: library.snapshotId,
    total: images.length,
    nextOffset:
      offset + items.length < images.length ? offset + items.length : null,
  };
}

/**
 * 只允许读取当前工作区快照内、未删除且路径去重后的图片版本。
 * @param fileVersionId 入口校验后的版本 UUID，绝不接受任意存储路径。
 * @param snapshotId 清单返回的快照 UUID。
 */
export async function readImageAttachment(
  fileVersionId: string,
  snapshotId: string,
) {
  const library = await getCurrentLibraryFiles();
  if (library.snapshotId !== snapshotId) return null;
  const image = library.files.find(
    (file) =>
      file.fileVersionId === fileVersionId &&
      (file.mediaType === "image/png" || file.mediaType === "image/jpeg"),
  );
  if (!image) return null;
  const [record] = await getDatabase()
    .select({ storageKey: fileVersions.storageKey })
    .from(fileVersions)
    .where(eq(fileVersions.id, fileVersionId))
    .limit(1);
  if (!record) return null;
  return {
    bytes: await readStoredFile(record.storageKey),
    mediaType: image.mediaType,
  };
}
