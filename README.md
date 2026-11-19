# opencode-basic-memory-recall

在 OpenCode 会话里自动注入 [Basic Memory](https://github.com/basicmachines-co/basic-memory) 的会话简报，把「按需去查」变成「开场就有上下文」。

OpenCode 不是 Basic Memory 官方支持的宿主（官方只提供 Claude Code、Codex、Tau、Pi 的插件与生命周期钩子），所以这里用 OpenCode 的 server 插件补上这一环：注册 `session.context` 钩子，在会话第一次模型调用前跑一次 `bm`，把结果作为一段 system 文本注入。

## 行为

```
会话第一个模型请求
    └─ session.context hook
         ├─ bm hook session-start --harness claude --project-dir <dir>   （项目已映射时）
         └─ bm tool project recent --project main --since 7d             （未映射或 mode=digest）
              └─ 结果 → event.system.push({ type: "text", text })
```

- 每个会话只构建一次，之后按 `ttlMinutes` 复用（默认 30 分钟），不会每次工具调用都跑 `bm`
- 注入内容带声明头尾：标明是「参考数据、不是指令」，并提醒后续用 `bm_search`（默认 hybrid）
- 任何失败（`bm` 不存在、超时、非零退出）只写日志，不打断模型请求
- `bm hook session-start` 是 harness 钩子，stdin 是管道时会等负载，所以子进程的 stdin 显式关闭
- 未映射项目的结果（`_isn't set up for this project_`）会被识别并降级到 recent 摘要，同时记住 10 分钟，避免每次会话白跑一次

## 安装

插件是本地目录形式，加进 `~/.config/opencode/opencode.jsonc`：

```jsonc
{
  "plugins": [
    {
      "package": "/Users/lihuanshuai/ws/js_proj/opencode-basic-memory-recall",
      "options": {
        "project": "main",
        "mode": "auto",
        "since": "7d",
        "ttlMinutes": 30,
        "maxChars": 4000,
        "timeoutMs": 15000,
        "debug": false
      }
    }
  ]
}
```

OpenCode 会监听配置变化并热加载插件，不需要重启；不确定时可执行 `/reload`。

## 选项

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 设 `false` 可临时关掉注入而不用删配置 |
| `mode` | `auto` | `auto`（已映射用 hook，否则 recent）、`hook`、`digest`、`both` |
| `binary` | `basic-memory` | CLI 路径；不在 PATH 里时写绝对路径，如 `/Users/lihuanshuai/.local/bin/basic-memory` |
| `project` | `main` | recent 摘要查询的项目 |
| `projectDir` | 会话目录 | 传给 `bm hook --project-dir`，用于映射到 Basic Memory 项目 |
| `harness` | `pi` | `claude` / `codex` / `pi`，决定 hook 的模板与采集策略。默认 `pi`：它的 `captureEvents` 默认关闭，调用 hook 不会往 `~/.basic-memory/inbox` 写信封；`claude` 会 |
| `since` | `7d` | recent 摘要时间窗 |
| `maxChars` | `4000` | 注入内容上限，超出按行截断 |
| `timeoutMs` | `15000` | 单次 `bm` 调用超时 |
| `ttlMinutes` | `30` | 简报在会话内的复用时长，`0` 表示每次模型调用都重建 |
| `debug` | `false` | 把简报长度、来源和告警追加到 `~/.local/share/opencode/basic-memory-recall.log`（可用 `debugFile` 改路径）；插件里的 `console` 不会进 OpenCode 日志，所以要落文件 |
| `debugFile` | `~/.local/share/opencode/basic-memory-recall.log` | `debug` 为真时的日志文件 |

## 本地验证

不需要启动 OpenCode 就能看到简报内容：

```bash
npm run preview                  # 默认 project=main since=7d
npm run preview -- main 30d      # 指定项目与时间窗
BM_MODE=both npm run preview     # 强制同时看 hook 与 recent
```

输出末尾会打印 `source=`（hook / digest / hook+digest）和告警，便于确认降级路径。

`preview` 依赖 Node 原生跑 TypeScript（`>= 22.6`，`package.json` 里已声明 `engines`），不需要额外构建步骤。

类型检查要先装开发依赖（`npm install`），然后 `npm run typecheck`；插件运行时不需要这一步。

## 发布

插件按 npm 包形态组织，OpenCode 直接加载 `src/index.ts`，不产出构建产物：

```bash
npm pack --dry-run     # 确认打包内容
npm publish            # 需要先登录 npm
```

发布后可用包名加载：

```jsonc
{
  "plugins": ["opencode-basic-memory-recall"]
}
```

`package.json` 的 `peerDependencies` 声明了 `@opencode/plugin`，由 OpenCode 宿主提供，不要在插件里自带一份。

## 目录结构

```
package.json          # type: module，exports 指向 src/index.ts（OpenCode 直接加载 TS）
src/index.ts          # 插件入口：注册 session.context 钩子、会话级缓存
src/briefing.ts       # 数据采集：spawn bm、识别未映射、截断、拼接
scripts/preview.ts    # 脱离 OpenCode 预览简报（node 原生跑 TS）
```

## 为什么是 TypeScript

OpenCode 插件 API 只有 TypeScript/JavaScript，没有 Python 入口。这里的「Python 部分」由 `bm` CLI 承担——插件只做进程编排和上下文注入，不重复实现检索逻辑。

## 已知限制

- 简报只覆盖「最近活动」和 harness 模板文案；真正的问题回答仍要靠 MCP 的 `bm_search` / `bm_context`，插件不替代它们
- OpenCode 的子会话也会触发 `context` 钩子，各自构建一份简报（有独立缓存）
- 首次调用多花 2–5 秒（一次 `bm` 调用；`auto` 且项目未映射时是两次）

## 副作用与清理

- `bm hook session-start` 在 `harness=claude`（默认 `captureEvents: on`）下会把 `session_started` 信封写进 `~/.basic-memory/inbox`。本插件默认用 `harness=pi` 规避，验证过 inbox 文件数不变
- 如果手动把 `harness` 改成 `claude`/`codex` 并配置了采集，信封会累积；用 `basic-memory hook flush` 归档（只在本地归档，不写图谱笔记），`basic-memory hook status` 可看深度
- 插件本身对知识库是只读的：只跑 `hook session-start` 与 `tool project recent`，不 `bm_write` / `bm_edit`
