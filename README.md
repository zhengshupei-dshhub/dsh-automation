# dsh-automation · DSH 定时自动化任务

跑在 [DeepSeek Harness](https://github.com/deepseek-ai) 里的定时任务集合。每个任务一个目录：说明、可执行脚本（如果有）、以及**喂给 DSH 调度器的提示词原文**。

> 这些不是插件，是「到点让 agent 做一件事」的自动化。它们依赖 DSH 常驻运行——应用退出就不会触发。

## 任务一览

| 任务 | 触发 | 类型 | 依赖 | 目录 |
|---|---|---|---|---|
| **WorkBuddy 每日签到 + 礼包** | 每天 09:10 | 脚本驱动 | `dsh-connect-workbuddy` 插件、WorkBuddy 已登录 | [`workbuddy-checkin/`](workbuddy-checkin/) |
| **空闲自我进化** | 每天 22:00 | 提示词驱动 | `dsh-memory` 插件（演化台账 + 工具） | [`self-evolution/`](self-evolution/) |

机器可读清单见 [`automations.json`](automations.json)。

---

## WorkBuddy 每日签到 + 礼包

领 WorkBuddy 的免费积分：每日签到（约 100/天）+ 两类礼包/补偿（`gift` / `compensation`）。走的是 `dsh-connect-workbuddy` 插件注册的本机回环接口，不爬网页、不碰凭据。

```bash
node checkin.mjs          # 人类可读
node checkin.mjs --json   # 机器可读
```

- 自动发现 DSH 端口（每次启动都会变），找不到端点会明确报错
- 日志：`~/.dsh/workbuddy-checkin.log`
- 退出码：`0` 正常（领到或已领过）；`1` 服务不可用/调用失败

## 空闲自我进化

每天 22:00 让 agent 自己推进一项改进：看演化台账 → 挑一项 → 改 → 跑自检 → 记账 → 提交。规则写死在提示词里（一次一项、不碰权限、不花钱、没值得做的就明说）。

完整提示词见 [`self-evolution/prompt.md`](self-evolution/prompt.md)。

---

## 如何注册到 DSH

DSH 用 `schedule_create` 注册定时提醒（每天 / 每周 / cron）。以每日签到为例：

```json
{
  "title": "WorkBuddy 每日签到 + 礼包领取",
  "prompt": "运行 `node ~/DeepSeekHarness/dsh-automation/workbuddy-checkin/checkin.mjs`，用一句话把结果告诉我。",
  "daily": { "time": "09:10:00", "time_zone": "Asia/Shanghai" }
}
```

注册后到点会在会话里触发一次，agent 执行提示词里的动作。改提示词、改时间都用 `schedule_update`，不必删了重建。

## 约定

- 任务只做**可回滚、可解释**的事：默认不删数据、不改权限配置、不产生花费
- 每个任务都要能在失败时自我说明（找不到服务、没权限、网络不通），不要静默失败
- 新增任务：建目录 → 写 README 与提示词 → 更新本页和 `automations.json`

## License

MIT
