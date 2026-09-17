<!-- 修改时间：2026-09-11 | 文件说明：VaultAgent DAY5 PDF 导入 Workflow 故障原因、修复与复验记录 | edit by：Sliye -->

# DAY5 PDF 导入 Workflow 故障复盘

状态：已完成代码修复，等待重启开发服务后的真实上传复验。

## 现象

上传 PDF 后，Workflow 内部 Step 接口返回 HTTP 200，但 Workflow Run 最终失败：

```text
FatalError: PDF 无法解析。请确认文件未损坏且未加密。
```

`/.well-known/workflow/v1/step` 的 HTTP 200 只表示内部 Step 回调已被 Next.js 接收，不表示导入、解析或索引成功。

## 排查证据

- `Blueiot Mqtt客户端通信协议V1.3.pdf`：7 页、未加密，PDF.js 成功提取 7 个页内 Chunk。
- `AoA生态协议-标签类V1.4.pdf`：24 页、未加密，PDF.js 成功提取 27 个页内 Chunk。
- 两份文件均有真实文本层；首次页面渲染正常。PDF.js 输出的 `ExtGState`、TrueType 警告是可恢复警告，不会阻断文本提取。
- 数据库中失败导入版本的 SHA-256 与下载目录中的两份原文件一致，排除浏览器上传字节被篡改或文件损坏。
- 三次失败批次均在 1–3 秒内失败，尚未进入 Embedding；因此不涉及 Gateway 密钥、模型调用或向量数据库。

## 原因

### 已确认：Workflow 错误序列化丢失了真实原因

`"use step"` 抛出的错误跨 Workflow 边界后会被序列化为普通对象，原实现使用 `error instanceof Error` 与 `error instanceof FatalError` 读取消息。序列化后这两个判断不成立，导入记录只保留 `Import file failed.`，批次记录只保留通用失败信息，无法继续定位 PDF.js 的原始异常。

### 已修复的运行时兼容风险：PDF.js 不应被服务端打包改写

PDF.js 在 Node.js 中使用原生模块能力读取 PDF 字节流与字体。Next.js 默认会打包服务端依赖；已在 `next.config.ts` 将 `pdfjs-dist` 放入 `serverExternalPackages`，让 Step 使用原生 Node.js 模块加载。官方说明见：<https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages>。

## 修复内容

- `next.config.ts`：增加 `serverExternalPackages: ["pdfjs-dist"]`。
- `lib/ingestion/errors.ts`：新增 `getErrorMessage()`，兼容普通 `Error` 与带 `message` 的序列化对象。
- `workflows/ingest-import-batch/index.ts`：文件失败和批次失败都通过 `getErrorMessage()` 保存真实错误。
- `workflows/ingest-import-batch/steps.ts`：解析失败时记录导入 ID、MIME 类型和安全错误消息，不记录 PDF 正文。
- `lib/ingestion/formats/pdf.ts`：记录文档级和页级 PDF.js 原始错误消息；前端继续仅展示简短、安全的中文提示。

## 验证与待验收

已完成：

- 使用项目同一份 `parsePdf` 源码直接解析两份真实 PDF，均成功。
- `pnpm exec tsc --noEmit` 通过。
- `pnpm lint` 无错误；保留两个既有警告。
- 生产构建已完成业务编译；Google Geist 字体拉取受网络限制产生外部资源警告，与 PDF 逻辑无关。

待验收：

1. 完全重启 `pnpm dev`，使新的 `next.config.ts` 生效。
2. 上传任一上述 PDF，失败时不删除导入记录。
3. 若仍失败，检查 `[ingestion:pdf]` 或 `[ingestion:parse]` 日志；导入记录应不再显示通用 `Import file failed.`，而是保留实际错误信息。
