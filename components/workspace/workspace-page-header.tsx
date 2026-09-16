/** 修改时间：2026-09-16 | 文件说明：知识库与审计页面共用的标题与说明区 | edit by：Sliye */
import type { LucideIcon } from "lucide-react";

/**
 * 统一管理页面的宽度、标题层级与主题图标。
 * @param props 页面标题、说明及对应导航图标。
 */
export function WorkspacePageHeader({ title, description, icon: Icon }: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-start gap-4 px-4 pb-6 pt-8 sm:px-8 sm:pt-10">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="size-5" />
      </div>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </header>
  );
}
