<!-- 修改时间：2026-09-13 | 文件说明：VaultAgent 导入领域模块边界 | edit by：Sliye -->

lib/ingestion/
├─ intake.ts          上传批次与总限额
├─ zip.ts             ZIP 安全读取、中文文件名解码
├─ source-path.ts     路径安全校验
├─ formats/
│  ├─ file-types.ts   MD/TXT/PDF/DOCX/XLSX/图片职责声明
│  ├─ markdown.ts
│  ├─ docx.ts         常规 DOCX 标题、段落与基础表格解析
│  ├─ xlsx.ts         基础 XLSX 工作表、单元格、公式缓存值与容器校验
│  ├─ txt.ts
│  ├─ registry.ts     按 MIME 分发解析器
│  └─ types.ts        统一 Chunk / 来源定位类型
├─ visual/
│  ├─ analyze-image.ts      PNG/JPEG 到结构化视觉描述的通用模型入口
│  ├─ stored-image-analysis.ts 跨格式视觉资产保存、分析状态与检索 Chunk 事务
│  ├─ registry.ts        依据 MIME 分派 PDF/DOCX/XLSX 视觉候选分析器
│  ├─ docx-image-analysis.ts DOCX 内嵌 PNG/JPEG 候选与额度编排
│  ├─ xlsx-image-analysis.ts XLSX 内嵌 PNG/JPEG、工作表锚点与额度编排
│  ├─ limits.ts                视觉领域统一资源限制与 PDF 渲染参数
│  ├─ pdf-page-renderer.ts  PDF 物理页到有界 PNG 的格式适配器
│  ├─ pdf-page-analysis.ts  PDF 无文本页候选、持久化与视觉 Chunk 编排
│  └─ types.ts              跨格式视觉来源与分析结果类型

workflows/ingest-import-batch/
├─ index.ts           仅编排 Durable Workflow
└─ steps.ts           解析、Embedding、发布等可恢复步骤
