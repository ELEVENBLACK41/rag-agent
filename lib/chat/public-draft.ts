/**
 * 修改时间：2026-09-16 | 文件说明：收集本轮 Agent 公开文本，作为最终回答的有限待核验草稿 | edit by：Sliye
 */

/** 草稿独立于来源预算；超限优先保留后续修正和结论，避免挤占证据上下文。 */
export const MAX_PUBLIC_DRAFT_CHARACTERS = 12_000;

/** 只允许公开正文与结束工具的公开结论，不接收 reasoning 或原始工具参数。 */
type DraftFragment = { kind: "public-text" | "finish-summary"; text: string };

/** 裁剪事实随草稿传递，最终生成不能把剩余内容当成完整执行记录。 */
export type PublicAnswerDraft = { fragments: DraftFragment[]; truncated: boolean };

/** 为单个 Run 创建草稿缓冲；与浏览器事件发布分别管理。 */
export function createPublicAnswerDraft() {
  /** 流 ID 只在本地用于合并同一段增量，不提供给最终模型。 */
  const fragments = new Map<string, DraftFragment>();
  /** 已保留正文的字符数，不含对象结构。 */
  let characters = 0;
  /** 一旦发生裁剪，后续即使空间空出也保留该事实。 */
  let truncated = false;

  return {
    /**
     * 接收公开文本增量；最旧内容先裁剪，保持剩余片段的生成顺序。
     * @param id 公开文本流或结束工具调用的唯一 ID。
     * @param kind 已由执行器区分的公开内容类型。
     * @param delta 尚未收集的文本增量。
     */
    append(id: string, kind: DraftFragment["kind"], delta: string) {
      if (!delta) return;
      const fragment = fragments.get(id) ?? { kind, text: "" };
      fragment.text += delta;
      fragments.set(id, fragment);
      characters += delta.length;
      for (const [oldestId, oldest] of fragments) {
        const overflow = characters - MAX_PUBLIC_DRAFT_CHARACTERS;
        if (overflow <= 0) break;
        truncated = true;
        const removed = Math.min(overflow, oldest.text.length);
        oldest.text = oldest.text.slice(removed);
        characters -= removed;
        if (!oldest.text) fragments.delete(oldestId);
      }
    },
    /** 返回独立副本，避免模型输入与后续流增量共享可变对象。 */
    getDraft(): PublicAnswerDraft {
      return {
        fragments: [...fragments.values()]
          .filter((fragment) => fragment.text.trim())
          .map((fragment) => ({ ...fragment })),
        truncated,
      };
    },
  };
}
