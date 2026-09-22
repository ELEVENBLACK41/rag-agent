<!-- 修改时间：2026-09-22 | 文件说明：固定 60 题评测集的资料、执行和评分口径 | edit by：Sliye -->

# 固定评测集 classic-v1-60

本版本共 60 题：40 条开发题、20 条留出题。开发题对应 4 份 Markdown 和 4 份已有的 PDF/DOCX/XLSX/Markdown fixture；留出题对应另外 2 份 Markdown。题目含 48 条 Markdown 单事实题、4 条跨格式 fixture 题、4 条组合题、4 条无答案题。资料均为虚构或仓库已有脱敏 fixture。原始事实、问题、证据定位和切分定义在 `dataset.mjs`，`corpus/` 由 `pnpm eval:prepare` 生成；变更题目或资料必须升级数据集版本。

## 隔离与准备

评测使用专用数据库和 `DATA_DIR`，不能在存有私人知识库的日常数据库中导入这 10 份资料。固定快照会在运行前校验文件名、SHA-256 和文件总数；索引 Chunk 缺少标注位置会直接失败。
项目声明 Node 22.x；运行前用 `node -v` 确认版本，Node 18 不支持执行器所需的参数。首次独立数据库还需执行项目迁移和 Workflow 自带的 schema 初始化。

```powershell
docker compose -f evals/classic/compose.yaml -p vaultagent-eval up -d
$env:DATABASE_URL = 'postgres://vaultagent:vaultagent_dev@localhost:5544/vaultagent_eval'
$env:WORKFLOW_POSTGRES_URL = $env:DATABASE_URL
$env:DATA_DIR = 'D:\rag-agent\data\classic-eval'
pnpm db:migrate
node node_modules/@workflow/world-postgres/bin/setup.js
pnpm eval:prepare
pnpm dev --port 3001
```

在第二个 PowerShell 窗口设置相同的 `DATABASE_URL` 和 `DATA_DIR`，执行 `pnpm eval:import http://localhost:3001`。命令通过现有导入 API 提交全部 10 个文件，完成后打印固定快照 UUID。也可在独立环境的知识库页面手动导入 `evals/classic/corpus/` 的全部文件，从 `GET /api/imports` 的 `snapshotId` 读取 UUID。导入期间的 Embedding 费用不计入问答单题费用。

```powershell
pnpm eval:run --snapshot=<快照UUID> --mode=both --split=development
pnpm eval:run --snapshot=<快照UUID> --mode=both --split=holdout
```

全量基线可用 `--split=all`，但调参先只运行开发集。可覆盖 `--keyword-limit`、`--vector-limit`、`--rerank-limit`、`--final-limit`、`--rrf-constant`、`--rerank-timeout-ms`。覆盖值仅在当前评测进程和对应问答 Run 内生效；日常服务仍使用 `lib/retrieval/config.ts` 的配置。每次运行按题顺序执行真实检索与 Agent 问答，因此会调用 Gateway 并产生实际费用；比较多个方案时先在开发集逐项筛选，再在留出集验证候选。

```powershell
pnpm eval:compare evals/reports/<基线>.json evals/reports/<候选>.json
```

报告写入忽略提交的 `evals/reports/`。管理端报告页可读取逐题指标、汇总、配置哈希和 Run 链接。比较器要求语料哈希、数据集版本和评分版本一致；候选可只包含基线的开发集子集，问答与仅检索报告之间只比较共同的检索指标。

## 评分口径

- 相关证据在运行时由稳定文件名与 Block ID 或格式定位映射到当前快照 Chunk ID。标注缺失即停止，不能将相关证据个数猜成分母。
- 关键词、向量、融合阶段评估前 10 条；最终结果固定评估前 6 条。给出 Hit、Recall、Precision、MRR 和二值 nDCG。无答案题不参与这些指标分母。
- 事实字面命中和引用精确率、覆盖率属于自动代理指标，不代表完整语义正确。双证据题要求两个标注都被引用；额外错误引用不能通过严格检查。
- 无答案正确性、语义任务成功和回答是否被证据支持需人工复核。可传 `--reviews=<JSON路径>`，格式为 `{ "题目ID": { "taskSuccess": true, "supported": true, "abstainedCorrectly": true } }`；缺失评分保留 `null`。
- 已有回答报告可用 `pnpm eval:review <报告.json> <复核结果.json>` 补录布尔结论，不再次调用模型；它会生成新版本报告并保留原报告。复核覆盖率单独展示。
- Token、模型费用、Embedding 和 rerank 费用来自实际 Run 或检索 Trace 的 Gateway 实报字段。任一步缺少金额，`answer_run_cost_usd` 就为 `null`；导入期间的索引费用另计，不把模型费用冒充完整成本。
- 时延含各阶段毫秒和 p50/p95，按本次成功记录样本计算；报告保留失败题数和缺失值，不用 0 填补。

此数据集主要验证可重复的检索、事实与引用链路；合成资料上的高分不能推断私人资料或开放问题的真实准确率。
