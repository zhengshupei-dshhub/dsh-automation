# 记忆数据每日备份

把 `~/.dsh/memory` 里的记忆数据推到**私有仓库** [dsh-memory-data](https://github.com/zhengshupei-dshhub/dsh-memory-data)。

## 备份什么

| 文件 | 内容 |
|---|---|
| `memories.json` | 长期记忆（事实 / 偏好 / 决策 / 教训） |
| `persona.json` | 人设：性格、说话方式、日记、共同经历 |
| `evolution/backlog.jsonl` | 自我迭代待办 |
| `evolution/journal.jsonl` | 已落地改动记录 |

不备份：密钥、`doubao.json`、`.dafeiyu-bridge.json` 等运行时游标。

## 用

```bash
node memory-backup/backup.mjs          # 有变化才提交推送
node memory-backup/backup.mjs --json   # 机器可读
```

- 私有仓库已经 clone 在 `~/DeepSeekHarness/dsh-memory-data`（可用 `DSH_MEMORY_BACKUP_DIR` 覆盖）
- 没有变化时直接退出，不制造空提交
- 提交信息带计数：`backup: 2026-11-01 13:00（记忆 34 条 / 日记 12 篇）`

## 恢复

见数据仓库的 [README](https://github.com/zhengshupei-dshhub/dsh-memory-data#怎么恢复)：关掉 DSH → 删掉 `~/.dsh/memory` → `git clone` 回来 → 重开 DSH。

## 挂在 DSH 上（每天 23:50）

```
schedule_create({
  title: "记忆数据每日备份",
  prompt: "运行 `node ~/DeepSeekHarness/dsh-automation/memory-backup/backup.mjs`，用一句话说明结果（有没有变化、提交号）。失败就报错误原因。",
  daily: { time: "23:50:00", time_zone: "Asia/Shanghai" }
})
```

## 前提

- 私有仓库已存在，且本机 gh 已登录（git 走 gh 的 credential helper）
- 需要代理才能 push：`export HTTPS_PROXY=http://127.0.0.1:7897`（git 已配全局代理，pnpm 才需要环境变量）
