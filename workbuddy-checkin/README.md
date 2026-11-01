# WorkBuddy 每日签到 + 礼包领取

每天领 WorkBuddy 的免费积分：**签到**（连续签到，约 100/天）和**礼包/补偿**（`gift` / `compensation` 两类活动）。

## 为什么能自动领

`dsh-connect-workbuddy` 插件在 **DSH 本机回环**上注册了官方接口（就是设置卡里「立即领取」按钮背后的同一个）：

| 动作 | 接口 |
|---|---|
| 每日签到 | `POST /plugins/dsh-connect-workbuddy/checkin?region=cn` |
| 礼包/补偿 | `POST /plugins/dsh-connect-workbuddy/benefit/claim?accountId=…&kind=gift\|compensation&region=cn` |

只收 POST、只接受本机回环请求，不需要额外 token。脚本不接触 WorkBuddy 账号密码或上游 API。

## 用

```bash
node checkin.mjs          # 人类可读
node checkin.mjs --json   # 机器可读（便于接别的自动化）
```

输出示例：

```
签到：今天已领（连续 6 天，每日 100）；gift：已领过（1500 积分）；compensation：活动未开启
```

- 端口自动发现：DSH 每次启动端口都变，脚本用 `lsof` 找监听端口再逐个探测端点
- 日志：`~/.dsh/workbuddy-checkin.log`，每次一行
- 退出码：`0` 正常（领到或已领过）；`1` 找不到服务 / 调用失败
- 幂等：已领过的签到和礼包不会重复领，只会如实报告状态

## 挂在 DSH 上（每天 09:10）

```
schedule_create({
  title: "WorkBuddy 每日签到 + 礼包领取",
  prompt: "运行 `node ~/DeepSeekHarness/dsh-automation/workbuddy-checkin/checkin.mjs`，用一句话把结果告诉我（领到多少 / 已领过时说明连续天数和礼包状态）。如果提示找不到端点，说明 DSH 没开或插件没启用，不要做其他事情。",
  daily: { time: "09:10:00", time_zone: "Asia/Shanghai" }
})
```

## 前提

- DSH 正在运行（定时任务由 DSH 调度）
- `dsh-connect-workbuddy` 插件已启用，国内区账号已登录
- 只想检查状态、不想触发领取时，直接 `GET` 那个路径会返回 `405 method not allowed`（只收 POST）
