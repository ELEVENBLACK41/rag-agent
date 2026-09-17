/** 修改时间：2026-09-17 | 文件说明：管理指标口径和采集覆盖目录，未实现项明确标注 | edit by：Sliye */
export const metricCatalog = [
  {
    group: "当前配置",
    source: "执行常量 / configuration 观测",
    unit: "模型 ID、条、字符、Token、毫秒",
    meaning: "当前值与历史快照分别展示；哈希覆盖实际记录字段",
    missing:
      "切块版本和实际指令哈希已记录；代码版本需要 APP_CODE_VERSION 或部署平台提供；金额预算尚未实现",
  },
  {
    group: "检索",
    source: "每次 retrieval_trace",
    unit: "候选 ID、排名、分数、毫秒",
    meaning: "关键词、向量、融合和最终结果分列；rerank 失败显示回退",
    missing:
      "旧 Run 可能没有阶段耗时、分数、查询向量用量；不同分数不可作为同一种概率比较",
  },
  {
    group: "Agent / 工具",
    source: "模型步骤观测与工具事件",
    unit: "次、毫秒",
    meaning: "同一请求按阶段和步骤标识去重；网页搜索单独辨认",
    missing:
      "供应商内部搜索次数、抓取页面及费用不可观测；不宣称应用事件等于底层调用次数",
  },
  {
    group: "模型 / 费用",
    source: "SDK 返回 usage / 管理观测",
    unit: "Token、USD",
    meaning: "输入、输出、缓存、推理分别保存；总量不重复累计子项",
    missing:
      "未返回 usage 显示未采集；费用尚未接入账单，不估造金额。步骤耗时包含工具执行",
  },
  {
    group: "时延 / 可靠性",
    source: "Run 时间与持久事件",
    unit: "毫秒、次",
    meaning:
      "排队与总耗时分开；p50/p95 使用 nearest-rank，仅统计当前样本的终态 Run",
    missing: "直接回答仅在完成后确认首正式答案；无事件不得填零",
  },
  {
    group: "来源 / 回答",
    source: "检索 Trace、上下文观测、完成事件",
    unit: "条、布尔、版本 ID",
    meaning: "候选、已读、最终引用区别展示；资料固定于 Run 快照",
    missing:
      "无效引用当前走失败边界，无剔除率；独立网页抓取和版本对齐已取消，标为不适用",
  },
  {
    group: "导入 / 资源",
    source: "导入、文件版本、Chunk、视觉资产表",
    unit: "个、字节、状态",
    meaning: "索引资源独立于问答；字节是版本元数据声明的原文件体积",
    missing:
      "实际磁盘/向量索引体积、Workflow 表体积和清理积压尚未采集；导入模型费用不计入聊天",
  },
  {
    group: "质量评测",
    source: "版本化评测报告（D15 接入执行器）",
    unit: "Recall@K、Precision@K、MRR、nDCG、任务成功率",
    meaning:
      "只有标注范围、证据粒度和评分版本一致才比较；最终 Top 6 不冒充 @10",
    missing: "当前尚无标准集和评测报告，全部显示未评测；来源数量不代表正确率",
  },
] as const;
