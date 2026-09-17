/** 修改时间：2026-09-17 | 文件说明：管理页面的数据加载状态 | edit by：Sliye */
/** 显示真实等待状态，不预填演示统计。 */
export default function AdminLoading() {
  return (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      正在读取运行记录…
    </p>
  );
}
