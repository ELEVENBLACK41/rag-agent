/** 修改时间：2026-09-22 | 文件说明：60 条脱敏固定任务与生成测试资料的唯一事实源 | edit by：Sliye */

/** 数据集版本变更时，旧报告仍保留原版本，不覆盖历史分数。 */
export const datasetVersion = "classic-v1-60";

/** 每条事实独占一个 Markdown 块；ID 用于跨重新索引定位证据。 */
const documents = [
  {
    file: "transport.md", title: "星港实验室运输手册", split: "development",
    facts: [
      ["t01", "常温样品交接窗口", "常温样品的交接窗口是工作日 09:30 至 16:30。", "常温样品在工作日几点可以交接？", "09:30 至 16:30"],
      ["t02", "冷链箱温度", "冷链箱出库时的目标温度区间为 2℃ 至 8℃。", "冷链箱离库前应处于什么温度范围？", "2℃ 至 8℃"],
      ["t03", "交接复核", "高价值样品交接必须由两名仓管员共同复核封签。", "贵重样品移交时需要几名仓管员核对封签？", "两名"],
      ["t04", "异常封签", "发现封签破损时应先拍照，再登记异常单号 YC-17。", "封签损坏后要登记哪个异常单号？", "YC-17"],
      ["t05", "空箱回收", "空冷链箱应在送达后的 48 小时内回收。", "冷链空箱送达后多久内收回？", "48 小时"],
      ["t06", "运输优先级", "标为橙色的样品运输优先级高于标为蓝色的样品。", "橙色和蓝色样品哪个先运？", "橙色"],
      ["t07", "中转停留", "样品在中转站的最长允许停留时间为 90 分钟。", "运输途中在中转站最多能停留多久？", "90 分钟"],
      ["t08", "签收凭证", "最终签收凭证统一命名为运单号加后缀 -receipt。", "交付完成后签收文件如何命名？", "-receipt"],
    ],
  },
  {
    file: "maintenance.md", title: "星港实验室设备维护", split: "development",
    facts: [
      ["m01", "校准周期", "温湿度记录仪每 90 天校准一次。", "温湿度记录设备隔多久重新校准？", "90 天"],
      ["m02", "电池预警", "设备电池余量低于 20% 时必须发出更换提醒。", "电池剩余多少以下触发换电提醒？", "20%"],
      ["m03", "停机审批", "计划停机超过 4 小时需要设备负责人审批。", "计划检修停机多长时间以上要负责人批准？", "4 小时"],
      ["m04", "维修工单", "设备故障维修工单使用前缀 WX-。", "故障维修工单的编号前缀是什么？", "WX-"],
      ["m05", "备件盘点", "关键备件每月第一个周五盘点。", "重要备件每月什么时候清点？", "第一个周五"],
      ["m06", "数据备份", "维护前的仪器参数备份至少保留 180 天。", "检修前保存的仪器参数至少留存多久？", "180 天"],
      ["m07", "复机验证", "维修后复机需连续完成三次空载自检。", "设备修好重新开机要做几次空载自检？", "三次"],
      ["m08", "校准标签", "校准合格标签采用绿色底色。", "通过校准的设备贴什么颜色的标签？", "绿色"],
    ],
  },
  {
    file: "access.md", title: "星港实验室资料权限", split: "development",
    facts: [
      ["a01", "访客权限", "访客账号的有效期最长为 7 天。", "临时访客账号最多可以开通多久？", "7 天"],
      ["a02", "导出审批", "批量导出超过 100 条记录需由数据管理员审批。", "一次导出多少条以上需要数据管理员批准？", "100 条"],
      ["a03", "审计留存", "访问审计日志至少保留 365 天。", "资料访问日志最少保存多长时间？", "365 天"],
      ["a04", "密钥轮换", "服务密钥每 60 天轮换一次。", "服务使用的密钥多久轮换？", "60 天"],
      ["a05", "离职停用", "离职账号在人员状态确认后 2 小时内停用。", "确认员工离职后多久要停用账号？", "2 小时"],
      ["a06", "恢复申请", "误删资料恢复申请使用表单 HF-03。", "误删文件要填哪张恢复申请表？", "HF-03"],
      ["a07", "共享范围", "带有内审标记的文件只允许审计组读取。", "内审资料允许哪个团队查看？", "审计组"],
      ["a08", "外链过期", "对外分享链接默认 24 小时后过期。", "向外部发出的分享链接默认多久失效？", "24 小时"],
    ],
  },
  {
    file: "finance.md", title: "星港实验室采购财务", split: "development",
    facts: [
      ["f01", "小额采购", "单笔不超过 800 元的常规采购可由组长审批。", "常规采购在什么金额以内由组长审批？", "800 元"],
      ["f02", "比价要求", "单笔超过 5000 元的采购至少取得三家供应商报价。", "超过五千元采购要有几家供应商报价？", "三家"],
      ["f03", "发票抬头", "实验室发票抬头统一填写星港实验室。", "采购发票应填写什么抬头？", "星港实验室"],
      ["f04", "报销截止", "当月费用报销材料须在次月 5 日前提交。", "本月费用最迟什么时候交报销材料？", "次月 5 日前"],
      ["f05", "预付款比例", "设备预付款不得超过合同金额的 30%。", "设备合同预付款最高占比是多少？", "30%"],
      ["f06", "验收入账", "设备验收单编号使用前缀 YS-。", "设备验收单的编号以什么开头？", "YS-"],
      ["f07", "差旅住宿", "普通员工出差住宿费上限为每晚 420 元。", "普通员工差旅住宿每晚最高报多少？", "420 元"],
      ["f08", "供应商复审", "活跃供应商每 12 个月复审一次。", "在用供应商隔多久重新审核？", "12 个月"],
    ],
  },
  {
    file: "support.md", title: "星港实验室客户支持", split: "holdout",
    facts: [
      ["s01", "首次响应", "普通支持工单应在 4 个工作小时内首次响应。", "普通客户工单初次回复的时限是多少？", "4 个工作小时"],
      ["s02", "紧急升级", "紧急故障超过 30 分钟未恢复时升级给值班经理。", "紧急故障半小时未解决应升级给谁？", "值班经理"],
      ["s03", "工单编号", "客户支持工单编号采用前缀 KH-。", "客服工单编号从什么字符开始？", "KH-"],
      ["s04", "回访时间", "问题关闭后应在 3 个工作日内完成回访。", "支持问题关闭后多久内联系客户回访？", "3 个工作日"],
      ["s05", "替代方案", "远程排障失败时优先提供临时离线导出方案。", "远程排查无效后优先给客户什么临时办法？", "临时离线导出"],
      ["s06", "夜间值班", "夜间支持值班时段为 20:00 至次日 08:00。", "夜间客服值守的时间范围是什么？", "20:00 至次日 08:00"],
      ["s07", "满意度阈值", "月度客户满意度低于 85% 时必须启动复盘。", "客户满意度跌到什么水平以下需要复盘？", "85%"],
      ["s08", "附件限制", "客户工单单个附件最大为 15 MB。", "客服工单每个附件允许多大？", "15 MB"],
    ],
  },
  {
    file: "incident.md", title: "星港实验室应急归档", split: "holdout",
    facts: [
      ["i01", "事故通报", "一级事故确认后 15 分钟内通知应急负责人。", "确认最高级别事故后多久通知负责人？", "15 分钟"],
      ["i02", "演练周期", "数据恢复演练每季度执行一次。", "数据恢复演习多长时间开展一次？", "每季度"],
      ["i03", "归档编号", "结案报告编号采用前缀 JA-。", "事故结案报告编号用什么前缀？", "JA-"],
      ["i04", "证据封存", "事故原始日志封存期限为 2 年。", "事故事实日志需要封存多久？", "2 年"],
      ["i05", "恢复目标", "核心查询服务的恢复时间目标为 45 分钟。", "核心查询服务计划在多久内恢复？", "45 分钟"],
      ["i06", "复盘会议", "一级事故的复盘会在恢复后 72 小时内召开。", "最高级别事故恢复后多久开复盘会？", "72 小时"],
      ["i07", "归档格式", "正式结案报告以 PDF/A 格式归档。", "最终事故报告用什么格式保存？", "PDF/A"],
      ["i08", "备份校验", "异地备份每周三进行完整性校验。", "异地备份每周哪天检查完整性？", "周三"],
    ],
  },
];

/** 每道单证据题保留事实文本和稳定块 ID，避免以运行时 Chunk ID 固定标注。 */
export const cases = documents.flatMap((document) => document.facts.map(([id, title, statement, question, answer]) => ({
  id, split: document.split, category: "single-evidence", question,
  expectedEvidence: [{ file: document.file, blockId: id }],
  expectedAnswerFacts: [answer],
  sourceTitle: title, sourceStatement: statement,
}))).concat([
  { id: "x01", split: "development", category: "cross-format", question: "D4 样本关联到哪份资料，块标识是什么？", expectedEvidence: [{ file: "vault-a.md", blockId: "d4-vault-a" }, { file: "vault-a.md", link: "vault-b" }], expectedAnswerFacts: ["vault-b", "d4-vault-a"] },
  { id: "x02", split: "development", category: "cross-format", question: "PDF 文本层示例的第一页应该标为第几页？", expectedEvidence: [{ file: "vaultagent-text-layer-fixture.pdf", format: "pdf", pageNumber: 1 }], expectedAnswerFacts: ["1"] },
  { id: "x03", split: "development", category: "cross-format", question: "DOCX 示例的基础表格是第几个表格？", expectedEvidence: [{ file: "vaultagent-docx-fixture.docx", format: "docx", tableIndex: 1 }], expectedAnswerFacts: ["1"] },
  { id: "x04", split: "development", category: "cross-format", question: "Overview 表中 B2*C2 的缓存计算结果是多少？", expectedEvidence: [{ file: "vaultagent-xlsx-fixture.xlsx", format: "xlsx", sheetName: "Overview", range: "A1:D4" }], expectedAnswerFacts: ["36"] },
  { id: "j01", split: "development", category: "multi-evidence", question: "冷链箱出库温度是多少，空箱最迟多久回收？", expectedEvidence: [{ file: "transport.md", blockId: "t02" }, { file: "transport.md", blockId: "t05" }], expectedAnswerFacts: ["2℃ 至 8℃", "48 小时"] },
  { id: "j02", split: "development", category: "multi-evidence", question: "临时访客账号最长有效多久，对外分享链接默认多久过期？", expectedEvidence: [{ file: "access.md", blockId: "a01" }, { file: "access.md", blockId: "a08" }], expectedAnswerFacts: ["7 天", "24 小时"] },
  { id: "j03", split: "holdout", category: "multi-evidence", question: "普通支持工单首次响应时限和关闭后的回访时限分别是什么？", expectedEvidence: [{ file: "support.md", blockId: "s01" }, { file: "support.md", blockId: "s04" }], expectedAnswerFacts: ["4 个工作小时", "3 个工作日"] },
  { id: "j04", split: "holdout", category: "multi-evidence", question: "一级事故要在多久内通知负责人，恢复后多久召开复盘会？", expectedEvidence: [{ file: "incident.md", blockId: "i01" }, { file: "incident.md", blockId: "i06" }], expectedAnswerFacts: ["15 分钟", "72 小时"] },
  { id: "n01", split: "development", category: "unanswerable", question: "运输手册规定的航空货运航班号是什么？", expectedEvidence: [], expectedAnswerFacts: [] },
  { id: "n02", split: "development", category: "unanswerable", question: "设备维护手册指定的电池供应商品牌是什么？", expectedEvidence: [], expectedAnswerFacts: [] },
  { id: "n03", split: "holdout", category: "unanswerable", question: "客服手册规定的电话总机号码是什么？", expectedEvidence: [], expectedAnswerFacts: [] },
  { id: "n04", split: "holdout", category: "unanswerable", question: "事故归档手册规定的外部保险公司名称是什么？", expectedEvidence: [], expectedAnswerFacts: [] },
]);

/** 固定导入清单；生成文件、仓库原有跨格式 fixture 都必须进入同一个隔离快照。 */
export const corpusFiles = [
  ...documents.map((document) => ({ file: document.file, content: `<!-- 修改时间：2026-09-22 | 文件说明：固定评测脱敏资料 | edit by：Sliye -->\n\n# ${document.title}\n\n${document.facts.map(([id, title, statement]) => `## ${title}\n\n${statement} ^${id}`).join("\n\n")}\n` })),
  { file: "vault-a.md", source: "fixtures/d4/vault-a.md" },
  { file: "vaultagent-text-layer-fixture.pdf", source: "fixtures/pdf/vaultagent-text-layer-fixture.pdf" },
  { file: "vaultagent-docx-fixture.docx", source: "fixtures/office/vaultagent-docx-fixture.docx" },
  { file: "vaultagent-xlsx-fixture.xlsx", source: "fixtures/office/vaultagent-xlsx-fixture.xlsx" },
];
