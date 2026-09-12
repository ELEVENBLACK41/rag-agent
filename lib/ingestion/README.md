<!-- 修改时间：2026-09-12 | 文件说明：VaultAgent 导入领域模块边界 | edit by：Sliye -->

lib/ingestion/
├─ intake.ts          上传批次与总限额
├─ zip.ts             ZIP 安全读取、中文文件名解码
├─ source-path.ts     路径安全校验
├─ formats/
│  ├─ file-types.ts   MD/TXT/PDF/DOCX/XLSX/图片职责声明
│  ├─ markdown.ts
│  ├─ txt.ts
│  ├─ registry.ts     按 MIME 分发解析器
│  └─ types.ts        统一 Chunk / 来源定位类型
├─ visual/
│  ├─ analyze-image.ts      PNG/JPEG 到结构化视觉描述的通用模型入口
│  ├─ pdf-page-renderer.ts  PDF 物理页到有界 PNG 的格式适配器
│  ├─ pdf-page-analysis.ts  PDF 无文本页候选、持久化与视觉 Chunk 编排
│  └─ types.ts              跨格式视觉来源与分析结果类型

workflows/ingest-import-batch/
├─ index.ts           仅编排 Durable Workflow
└─ steps.ts           解析、Embedding、发布等可恢复步骤
