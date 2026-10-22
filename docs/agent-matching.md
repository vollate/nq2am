# 可调试歌曲匹配 Agent

1. 在设置页的 **Agent / LLM API** 填写 OpenAI 兼容 Base URL、模型和可选密钥，保存。
2. **测试工具调用连接** 使用当前表单，不保存；空密钥保留已保存密钥。测试会发送一次最小 function-call 对话，可能计费（瞬时错误或参数兼容处理可能重试）。
3. 先完成普通匹配，在 **Agent 匹配（N）** 旁选择范围：请求失败、未找到、评分未通过、存在歧义、已选择或全部，与普通重试使用相同分组。默认「已选择」仅处理勾选歌曲；切换到问题分类标签时，范围会随标签切换。确认数量后点击 Agent 按钮；选择范围本身不会发起请求。普通匹配和普通重试不会调用 LLM。
4. 原列表保持可见。只有通过服务端校验、确认账户区域可用的匹配才替换原结果；其他结论仅附加执行记录。完成后仍可人工改选；显式普通重试会清除重试行的旧 Agent 记录。
5. 使用报告中的路径查看本地日志。日志不会自动清理，包含歌曲信息和完整的脱敏模型上下文，请勿随意公开。

## 配置与安全

仅支持本机、单用户。新接口检查真实 loopback socket、Host 和 Origin；允许同源及本机 HTTP Vite 5173 Origin，不信任转发头。首版不支持公开代理部署或多用户。

- 密钥是本地明文，保存在 `<getDataDir()>/agent-settings.json`，权限 `0600`；不返回浏览器、不写入浏览器存储。
- `PUT` 省略 `apiKey` 保留；`null` 清除。允许无密钥的本地兼容服务。
- Base URL 仅允许 HTTPS 或 loopback HTTP，不允许内嵌凭证、query、fragment；LLM 请求拒绝所有重定向。
- 歌曲和工具返回都是不可信数据。工具没有 Shell、任意 URL、文件或创建歌单能力。已有候选及工具返回的真实候选才可被选择；同名歧义不能作为艺人身份依据；明确录音版本冲突拒绝成功。
- 运行时任务锁覆盖匹配、重试、Agent、创建歌单；修改歌曲、人工改选、删除或覆盖导入返回 409。重复启动同一选择返回当前 runId。

## 运行边界与诊断

每批串行、每首最多 8 次 LLM HTTP 请求（含重试）、16 次查询、180 秒；单次请求 60 秒，输出上限 2048 tokens。每次上下文最大 128 KiB，超出时结束该曲而不裁剪历史。网络错误、429、5xx 最多重试一次，Retry-After 最多等待 10 秒。优先 `max_tokens`，仅明确不支持时切换 `max_completion_tokens`，按 endpoint/model 记忆。

工具选择使用 `tool_choice: auto`，兼容 DeepSeek 默认思考模式（该模式拒绝 `required`）；响应仍必须包含有效工具调用，纯文本不会视为成功。连接测试也使用 2048-token 上限，给思考模式留出空间。HTTP 错误仅展示和记录经过脱敏、限长的 message/code/type/param，不保存供应商回显的完整错误对象。

每批固定设置、原结果及本地别名快照，共用一个独立 Apple session 和查询缓存。取消中止后续请求和写回，不关闭其他任务的浏览器；重启标记 interrupted，不自动续跑。

日志位于 `<getDataDir()>/agent-runs/<runId>/`，目录权限 `0700`、文件 `0600`：

- `manifest.json`：参数、选择、状态、prompt 版本/前缀 SHA-256/字节数、用量。
- `track-<index>/trace.jsonl`：请求体、响应、工具调用及结果、重试、验证错误和耗时。新记录附带日志观察时间 `recordedAt`；原有历史文件不回填。
- `track-<index>/result.json`：脱敏原结果、结论和应用结果。

macOS 默认数据目录：`~/Library/Application Support/nq2am/`，可用 `NQ2AM_DATA_DIR` 覆盖。启动前日志写盘失败不会调用 LLM；中途日志或任务持久化失败停止后续处理。

共享前缀是固定版本 system prompt 和固定顺序工具定义；动态数据仅在 user/tool 消息，历史只追加。`cachedTokens: null` 表示供应商未提供统计，`0` 表示实际报告为零；真实命中率取决于供应商，不承诺固定命中率。

## Mastra Studio 观测

`pnpm studio` 启动独立的本地观测界面；打开/刷新 Traces 会自动发现所有批次的新日志，无需 `pnpm studio:sync`。当前原生 Auto refresh 在 LibSQL 模式下不会自动重拉列表，查看新批次时直接刷新页面即可。它只读日志，不接管 Agent、不重跑匹配。旧日志缺少时间戳时会跳过并报告，不能直接绘制时间轴。详见 [启动、限制与安全说明](mastra-studio.md)。

## 验证

离线测试：`tests/agent-core.test.ts`、`tests/agent-settings.test.ts`、`tests/agent-service.test.ts`，均使用假 LLM/Apple session，不消耗 LLM 配额。

运行：

```sh
pnpm run typecheck
pnpm --dir web exec tsc --noEmit
pnpm test
pnpm run build:web
```

上线前人工验收：保存设置 → 测试连接 → 勾选两首 → Agent 匹配 → 人工改选 → 查看本地上下文。真实服务的工具兼容性和连续请求缓存命中需用自己的服务单独核验，这会产生可能的费用。
