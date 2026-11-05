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

const summary = {
  checkedAt: new Date().toISOString(),
  planPeriods: periods,
  packs,
  alerts,
}

// 落一份快照，给模型路由插件判断「这个包还有没有余量」。
try {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
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
  if (alerts.length) {
    console.log('== 告警 ==')
    for (const a of alerts) console.log(`  ! ${a}`)
  } else {
    console.log('== 告警 ==\n  无')
  }
}

if (STRICT && alerts.length) process.exitCode = 1
