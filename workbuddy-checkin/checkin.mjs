#!/usr/bin/env node
/**
 * 领取 WorkBuddy 的免费积分：每日签到 + 礼包/补偿。
 *
 * 只走 dsh-connect-workbuddy 插件自己注册的本机回环端点
 * （POST …/checkin 与 …/benefit/claim），也就是设置卡里
 * 「立即领取」按钮背后的同一批接口——不爬网页、不碰凭据、不直连上游。
 *
 * 用法：node scripts/workbuddy-checkin.mjs [--json]
 * 退出码：0 正常（领到或今天已领过）；1 找不到服务或调用失败。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = '/plugins/dsh-connect-workbuddy'
const REGION = 'cn'
const LOG = path.join(os.homedir(), '.dsh', 'workbuddy-checkin.log')
const JSON_OUT = process.argv.includes('--json')
const BENEFIT_KINDS = ['gift', 'compensation']

/** DSH 每次启动端口都会变，所以按「本机监听的端口」现场找，而不是写死。 */
function candidatePorts() {
  const ports = new Set()
  if (process.env.DSH_WEB_PORT) ports.add(Number(process.env.DSH_WEB_PORT))
  try {
    const out = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' })
    for (const line of out.split('\n')) {
      if (!/DeepSeek|dsh/i.test(line)) continue
      const match = line.match(/127\.0\.0\.1:(\d+) \(LISTEN\)/)
      if (match) ports.add(Number(match[1]))
    }
  } catch {
    // lsof 不可用就看环境变量
  }
  return [...ports]
}

/** 探测哪个端口上挂着 WorkBuddy 端点：GET 签到接口应当返回 405（只收 POST）。 */
async function findBase() {
  for (const port of candidatePorts()) {
    const origin = `http://127.0.0.1:${port}`
    try {
      const res = await fetch(`${origin}${BASE}/checkin?region=${REGION}`, { method: 'GET' })
      if (res.status === 405 || res.status === 200) return origin
    } catch {
      // 端口关了或不是 DSH，继续试下一个
    }
  }
  return undefined
}

function appendLog(line) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true })
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`, 'utf8')
  } catch {
    // 日志写不进去不影响领取
  }
}

async function claimCheckin(origin) {
  const res = await fetch(`${origin}${BASE}/checkin?region=${REGION}`, { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (res.status === 409) return { ok: false, text: `签到活动不可用（${body.error ?? 'not active'}）` }
  if (!res.ok) return { ok: false, text: `签到失败 HTTP ${res.status}：${body.error ?? '未知错误'}` }
  const c = body.checkin ?? {}
  if (body.alreadyCheckedIn) {
    return { ok: true, already: true, text: `签到：今天已领（连续 ${c.streakDays ?? 0} 天，每日 ${c.dailyCredit ?? 0}）` }
  }
  const gained = body.claim?.credit ?? body.claim?.amount ?? c.dailyCredit ?? 0
  return { ok: true, already: false, gained, text: `签到：+${gained} 积分（连续 ${c.streakDays ?? 0} 天）` }
}

/** 账户 id 从 usage 里取；拿不到就跳过礼包（签到已经领过了）。 */
async function resolveAccountId(origin) {
  try {
    const res = await fetch(`${origin}${BASE}/usage?region=${REGION}&detail=full`)
    if (!res.ok) return undefined
    const j = await res.json()
    return j.accountId ?? j.pool?.accounts?.[0]?.accountId
  } catch {
    return undefined
  }
}

/**
 * 礼包/补偿：每个 kind 一次 POST。
 * 409 的两种含义都是正常状态：已经领过 / 活动没开。
 */
async function claimBenefits(origin, accountId) {
  const results = []
  for (const kind of BENEFIT_KINDS) {
    const url = `${origin}${BASE}/benefit/claim?accountId=${encodeURIComponent(accountId)}&kind=${kind}&region=${REGION}`
    let res
    try {
      res = await fetch(url, { method: 'POST' })
    } catch (error) {
      results.push({ kind, state: 'error', text: `${kind}：请求失败（${error.message}）` })
      continue
    }
    const body = await res.json().catch(() => ({}))
    const benefit = body.benefit ?? {}
    if (res.ok) {
      const credit = benefit.creditNum ?? body.creditNum ?? '?'
      results.push({ kind, state: 'claimed', credit, text: `${kind}：领取成功 +${credit}` })
      continue
    }
    if (res.status === 409) {
      if (body.error === 'benefit already claimed') {
        results.push({ kind, state: 'already', text: `${kind}：已领过（${benefit.creditNum ?? '?'} 积分）` })
      } else {
        results.push({ kind, state: 'inactive', text: `${kind}：活动未开启` })
      }
      continue
    }
    results.push({ kind, state: 'error', text: `${kind}：HTTP ${res.status} ${body.error ?? ''}`.trim() })
  }
  return results
}

async function main() {
  const origin = await findBase()
  if (!origin) {
    const text = '没找到 DSH 的 WorkBuddy 端点：应用可能没开，或者插件没启用。'
    appendLog(text)
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: 'endpoint-not-found' }))
    else console.log(text)
    process.exit(1)
  }

  const checkin = await claimCheckin(origin)
  const accountId = await resolveAccountId(origin)
  const benefits = accountId ? await claimBenefits(origin, accountId) : []

  const claimedNow = benefits.filter((b) => b.state === 'claimed')
  const lines = [checkin.text, ...benefits.map((b) => b.text)]
  const summary = lines.join('；')

  appendLog(summary)
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: checkin.ok, checkin, benefits, claimedNow: claimedNow.length }))
  } else {
    console.log(summary)
  }
  if (!checkin.ok) process.exit(1)
}

main().catch((error) => {
  const text = `领取出错：${error instanceof Error ? error.message : String(error)}`
  appendLog(text)
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: text }))
  else console.log(text)
  process.exit(1)
})
