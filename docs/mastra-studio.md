# Mastra Studio：只接观测，不迁移 Agent

## 1. 启动 / Start

Studio 需要 **Node.js 22.18+（22.x）或 24.11+**，由 CLI 的实际依赖决定。依赖隔离在 `studio/` 工作区；主程序不加载 Mastra SDK。

```sh
pnpm install
pnpm studio
```

打开 **http://127.0.0.1:4111/observability**，进入 **Observability → Traces**。

**Agents 列表为空是正常的**：现有 Agent 没有迁移到 Mastra，Studio 仅用于查看执行记录。原生界面是英文，nq2am 原有中英文界面不变。

先看不产生费用的演示：

```sh
pnpm studio:demo
```

演示使用独立临时目录中的合成成功/失败记录，不打开真实 Agent 数据、不调用模型或 Apple Music。退出用 `Ctrl+C`。正常模式和演示模式共用默认端口，请先停止其中一个。

## 2. 查看新运行 / Refresh history

1. 应用更新并重启 nq2am，再正常使用 Agent 按钮；若已有运行，先等待完成再重启。执行仍由现有代码负责，费用规则不变。
2. 打开 Studio 的 **Traces**；读取列表或详情时会自动扫描 `agent-runs/` 下的所有批次，不需要运行同步命令。
3. 新运行完成后，打开或刷新 **Traces** 页面，选择歌曲、轮次、模型或工具节点。无需先运行终端命令。

**原生 Auto refresh 的当前限制：** 固定的 Mastra Studio 版本在 LibSQL 的 legacy 查询模式中，滚动时间更新没有改变列表查询 key，也没有重新拉取列表。已通过浏览器测试和已安装源码核对；因此目前以打开/刷新页面为可靠入口，不承诺页面静置时实时出现新日志，也不注入自定义页面脚本或修改上游 bundle。

启动时也会扫描一次。自动扫描由本地观测读取请求触发，同一秒内复用结果，并发请求共用一次扫描；没有第二个后台扫描进程，不自动启动 Agent。缓存未变化文件的 inode/大小/纳秒修改时间与状态变化时间，只重新读取变化的内容；批次进度变化不会重建已完成歌曲的 trace。运行中、缺少终止事件或结果尚未落盘的记录会跳过，源文件写完后自动重试。

`pnpm studio:sync` 仍可用于手动立即扫描和打印诊断报告，但不再是查看新日志的必需步骤。

| 位置 | 内容 |
| --- | --- |
| 每首歌的根节点 | 原始结果、模型提议、已校验结论、`result.json` 中的应用结果快照、证据引用对应的 span ID |
| `Round N` | 一次逻辑 LLM 轮次；HTTP 重试归入原轮次，工具调用及返回放在一起 |
| `HTTP N` | 输入消息、输出、思考文本、token/cache/reasoning 用量；完整脱敏请求和响应保留在 Metadata |
| 工具节点 | 解码后的参数、返回结果、原始 call ID、缺失结果或验证错误；映射事件归入正在执行的工具 |
| Metadata | 源 JSONL 相对路径与行号、原始 `recordedDurationMs`、prompt 版本/前缀哈希等诊断信息 |

`no_match` 可以是成功执行，且原来的 `ambiguous` 选择不变。模型提议不等于已接受结论；应用快照也不代表后续人工修改后的当前任务状态。结论与最后终止事件不一致时拒绝导入，不把旧的成功缓存继续显示为成功。

## 3. 明确的限制 / Limitations

- **旧日志没有事件时间戳时不导入。** 本次仅给新写入的 JSONL 对象添加 `recordedAt`，不修改旧文件，不推算或伪造时间轴。已分析的那批 33 首旧日志需要另行处理，不能直接显示在本次接入的时间轴里。
- Studio 的时长按日志观察时间计算，包含日志处理间隔；原有实测耗时在 `metadata.recordedDurationMs`。缺少 token 数据时不填零：不完整的主计数会隐藏原生 token 汇总组件，已有统计仍保留在 Metadata。Reasoning 属于 output tokens，不额外累加。
- 取消和中断的真实状态保留在 `metadata.executionStatus`。Mastra 原生只有 success/error/running 分类，因此取消和中断在原生状态列中归为 error，而不是假装成功或一直运行。
- 保留原生 UI，不制作另一套 reader。默认的输入输出、折叠行为和英文导航来自 Mastra；没有歌曲专用对比页面、上下文增量 diff 或通用任意 JSONL 导入功能。
- 同步会跳过不完整、损坏、超过 16 MiB 或不安全的源文件。查看 **http://127.0.0.1:4111/nq2am/import-status** 获取实际日志目录、自动发现模式、最近扫描的路径及跳过原因。缺失时间戳为 `missing_timestamps`，结果不一致为 `inconsistent_result`；同步命令也会打印报告。

## 4. 数据与安全 / Local-only data

```text
<getDataDir()>/agent-runs/…/trace.jsonl + result.json + manifest.json
                         ↓ 只读扫描和投影
<getDataDir()>/mastra-studio/traces.db
                         ↓
                 原生 Mastra Studio
```

- 数据目录与主程序一致，可用 `NQ2AM_DATA_DIR` 覆盖。缓存目录 `0700`、数据库文件 `0600`；缓存含脱敏上下文，应与原日志一样保密。刷新只更新或移除本适配器的派生记录，不删除原日志、不修改任务结果；缓存不是新的权威结果来源，也不会随整个原日志目录的删除自动清空。
- 服务器只监听 `127.0.0.1`，同时检查实际 socket、Host、Origin；不信任转发头，不开启宽泛 CORS。需要其他端口时，启动及同步都使用同一 `NQ2AM_STUDIO_PORT`。
- 不读取 `agent-settings.json` 或浏览器 cookies，不注册 Agent、工具、工作流或评分器。执行、编辑、删除和评分 API 均禁用；唯一开放的 POST 是 `/nq2am/sync`，只刷新本地索引。原生界面仍可能显示这些菜单，操作会被拒绝。
- 启动脚本移除凭证类环境变量、关闭 Mastra 遥测，不配置云端 exporter；预加载网络保护阻止进程的 fetch/Node HTTP 外连，页面 CSP 禁止外部连接与图片。网络保护是防御措施，不是 OS 沙箱。**请用 `pnpm studio` 启动，不绕过脚本直接运行 CLI 或公开代理部署。**
- 原有 JSONL 日志仍是权威诊断记录。预算、DeepSeek 字段回传、工具校验、取消写屏障和日志持久化失败即停止的机制均未改动。Studio 不启动也不影响 Agent；Studio 的索引错误不会进入付费执行链。

## 5. 离线验证 / Verification

```sh
pnpm run typecheck
pnpm test
pnpm --dir studio run typecheck
pnpm --dir studio test
pnpm --dir studio test:ui
```

`test:ui` 会启动真实 Mastra CLI 和浏览器，仅使用临时合成日志，检查轮次/工具、失败详情、用量、打开页面后新建批次在刷新页面时的自动发现（无需同步命令）、未完成记录的跳过与重试、Host/Origin/只读保护和浏览器零外部请求。结束后停止测试服务器。测试前请停止该工作区的其他 Studio 开发进程，以免共享 `.mastra` 构建目录。

UI 截图写入系统临时目录：`nq2am-studio-model.png`、`nq2am-studio-failure.png`。
