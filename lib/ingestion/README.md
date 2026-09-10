lib/ingestion/
├─ intake.ts          上传批次与总限额
├─ zip.ts             ZIP 安全读取、中文文件名解码
├─ source-path.ts     路径安全校验
├─ formats/
│  ├─ file-types.ts   MD/TXT/PDF/DOCX/XLSX/图片职责声明
│  ├─ markdown.ts
│  ├─ plain-text.ts
│  ├─ registry.ts     按 MIME 分发解析器
│  └─ types.ts        统一 Chunk / 来源定位类型

workflows/ingest-import-batch/
├─ index.ts           仅编排 Durable Workflow
└─ steps.ts           解析、Embedding、发布等可恢复步骤