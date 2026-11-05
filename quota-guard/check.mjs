#!/usr/bin/env node
/**
 * 余量哨兵：查 Agent Plan 的 5 小时/周/月额度 + 免费资源包余量，
 * 低于阈值就报警，避免「不知不觉烧穿套餐、掉到按量计费的账户余额」。
 *
 * 用法：
 *   node check.mjs            打印摘要，正常退出码 0
 *   node check.mjs --json     机器可读
 *   node check.mjs --strict   有告警时退出码 1（给定时任务用）
 *
 * 阈值可用环境变量覆盖：
 *   QUOTA_WARN_5H=85        5 小时窗口已用百分比超过此值告警
 *   QUOTA_WARN_WEEK=80
 *   QUOTA_PACK_MIN=20       单个资源包剩余百分比低于此值告警
 */

import { execFileSync } from 'node:child_process'
import fsMod from 'node:fs'
import osMod from 'node:os'
import pathMod from 'node:path'

const fs = fsMod
const os = osMod
const path = pathMod

const WARN_5H = Number(process.env.QUOTA_WARN_5H ?? 85)
const WARN_WEEK = Number(process.env.QUOTA_WARN_WEEK ?? 80)
const PACK_MIN = Number(process.env.QUOTA_PACK_MIN ?? 20)
const JSON_OUT = process.argv.includes('--json')
const STRICT = process.argv.includes('--strict')

function arkcli(args) {
  const out = execFileSync('arkcli', args, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] })
  return JSON.parse(out)
}

function safe(fn, fallback) {
  try {
    return fn()
  } catch (error) {
    return { error: String(error?.message ?? error).slice(0, 300), fallback }
  }
}

const alerts = []

const plan = safe(() => arkcli(['usage', 'plan', '--format', 'json']))
const periods = []
if (plan?.items) {
  for (const item of plan.items) {
    for (const p of item.periods ?? []) {
      const pct = p.total ? (p.used / p.total) * 100 : 0
      periods.push({ label: p.label, used: p.used, total: p.total, percent: Number(pct.toFixed(2)), resetAt: p.reset_at })
      if (p.label === '5h' && pct >= WARN_5H) alerts.push(`5 小时额度已用 ${pct.toFixed(1)}%（阈值 ${WARN_5H}%），${p.reset_at} 重置`)
      if (p.label === 'weekly' && pct >= WARN_WEEK) alerts.push(`本周额度已用 ${pct.toFixed(1)}%（阈值 ${WARN_WEEK}%）`)
    }
  }
} else if (plan?.error) {
  alerts.push(`查不到套餐额度：${plan.error}`)
}

const packs = []
const quota = safe(() => arkcli(['usage', 'balance', '--type', 'free-quota', '--format', 'json', '--page-all']))
for (const item of quota?.items ?? []) {
  const list = item.resource_packs ?? []
  const remaining = list.reduce((sum, p) => sum + (p.remaining ?? 0), 0)
  const total = list.reduce((sum, p) => sum + (p.total ?? 0), 0)
  if (!total) continue
  const percent = Number(((remaining / total) * 100).toFixed(1))
  packs.push({ model: item.model, state: item.state, remaining, total, percent })
  if (percent < PACK_MIN && item.state === 'Available') {
    alerts.push(`资源包 ${item.model} 只剩 ${percent}%（阈值 ${PACK_MIN}%）`)
  }
}
if (quota?.error) alerts.push(`查不到资源包：${quota.error}`)


// ── 路由目标自检：确认「开局选模型」插件指向的每个模型都还在 provider 列表里。
// 依赖：~/.dsh/profiles/desktop/cordis.patch.yml（Ark 两个 provider），
// 以及 WorkBuddy 的模型缓存（由 dsh-connect-workbuddy 维护）。
function checkRouterTargets() {
  const fs = fsMod
  const os = osMod
  const path = pathMod
  const results = []

  const routerSrc = path.join(os.homedir(), 'DeepSeekHarness', 'dsh-model-router', 'index.js')
  let text
  try {
    text = fs.readFileSync(routerSrc, 'utf8')
  } catch {
    return { ok: false, reason: '找不到路由插件源码', targets: [] }
  }

  const rules = []
  const re = /id: '([a-z-]+)',[\s\S]*?provider: '([a-z-]+)',\s*\n\s*model: '([^']+)'/g
  let m
  while ((m = re.exec(text)) !== null) rules.push({ rule: m[1], provider: m[2], model: m[3] })
  const def = text.match(/default: \{ provider: '([a-z-]+)', model: '([^']+)' \}/)
  if (def) rules.push({ rule: 'default', provider: def[1], model: def[2] })

  // Ark provider 列表：用 python3 解析 YAML（缩进随 dump 变化，别再自己写行解析）
  const providers = {}
  try {
    const cfgPath = path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')
    const out = execFileSync(
      'python3',
      ['-c', 'import yaml,json,sys;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', cfgPath],
      { encoding: 'utf8', timeout: 20_000 },
    )
    const doc = JSON.parse(out)
    for (const row of doc) {
      if (row?.id !== 'llm-pi-ai') continue
      for (const [name, prov] of Object.entries(row.config?.providers ?? {})) {
        providers[name] = (prov.models ?? []).map((m) => m.id)
      }
    }
  } catch (error) {
    alerts.push(`读不到 provider 配置：${error?.message ?? error}`)
  }

  // WorkBuddy 模型：读插件缓存
  let workbuddyIds = new Set()
  for (const f of ['.workbuddy-pool.cn.json', '.workbuddy-roster-seen.cn.json']) {
    try {
      const raw = fs.readFileSync(path.join(os.homedir(), '.dsh', f), 'utf8')
      for (const hit of raw.match(/"hy3[a-z0-9._-]*"/gi) ?? []) workbuddyIds.add(hit.replace(/"/g, ''))
      for (const hit of raw.match(/"wb-[a-z0-9-]+"/gi) ?? []) workbuddyIds.add(hit.replace(/"/g, ''))
    } catch {}
  }

  for (const t of rules) {
    let ok
    if (t.provider === 'workbuddy' || t.provider === 'workbuddy-global') {
      ok = workbuddyIds.size ? workbuddyIds.has(t.model) : undefined
    } else {
      const list = providers[t.provider]
      ok = list ? list.includes(t.model) : false
    }
    results.push({ ...t, ok })
    if (ok === false) alerts.push(`路由目标失效：${t.rule} → ${t.provider}/${t.model} 不在可用列表里`)
  }
  return { ok: results.every((r) => r.ok !== false), targets: results }
}

const routerCheck = safe(checkRouterTargets, { targets: [] })

const summary = {
  checkedAt: new Date().toISOString(),
  planPeriods: periods,
  packs,
  routerTargets: routerCheck?.targets ?? [],
  alerts,
}

// 落一份快照，给模型路由插件判断「这个包还有没有余量」。
try {
  const file = path.join(os.homedir(), '.dsh', 'quota-snapshot.json')
  fs.writeFileSync(file, JSON.stringify(summary, null, 2))
} catch {}

if (JSON_OUT) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log('== Agent Plan 额度 ==')
  const planRows = periods.filter((p) => ['5h', 'weekly', 'monthly'].includes(p.label))
  if (!planRows.length) console.log('  （查不到）')
  for (const p of planRows) {
    const flag = p.label === '5h' && p.percent >= WARN_5H ? ' ⚠' : ''
    console.log(`  ${p.label.padEnd(8)} ${String(p.used).padStart(9)} / ${String(p.total).padEnd(8)} ${String(p.percent).padStart(6)}%  重置 ${p.resetAt ?? '-'}${flag}`)
  }

  console.log('')
  console.log('== 免费资源包 ==')
  const low = packs.filter((p) => p.percent < PACK_MIN).sort((a, b) => a.percent - b.percent)
  if (!low.length) console.log(`  （全部高于 ${PACK_MIN}%）`)
  for (const p of low) console.log(`  ⚠ ${p.model.padEnd(30)} ${String(p.remaining).padStart(9)} / ${p.total} (${p.percent}%)`)
  const totalRemaining = packs.reduce((s, p) => s + p.remaining, 0)
  console.log(`  合计剩余 ${totalRemaining.toLocaleString()}（${packs.length} 个包）`)

  console.log('')
  console.log('== 路由目标 ==')
  const targets = routerCheck?.targets ?? []
  if (!targets.length) console.log('  （未检查）')
  for (const t of targets) {
    console.log(`  ${t.ok === false ? '✗' : t.ok === undefined ? '?' : '✓'} ${String(t.rule).padEnd(10)} ${t.provider}/${t.model}`)
  }

  console.log('')
  if (alerts.length) {
    console.log('== 告警 ==')
    for (const a of alerts) console.log(`  ! ${a}`)
  } else {
    console.log('== 告警 ==\n  无')
  }
}

if (STRICT && alerts.length) process.exitCode = 1
