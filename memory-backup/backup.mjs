#!/usr/bin/env node
/**
 * 把 ~/.dsh/memory 的记忆数据备份到私有仓库。
 *
 * 只同步四类数据文件（记忆 / 人设 / 演化台账），不含任何密钥或运行时游标。
 * 有变化才 commit + push；没有变化直接退出，不制造空提交。
 *
 * 用法：node memory-backup/backup.mjs [--json]
 * 退出码：0 成功（含无变化）；1 失败。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SRC = path.join(os.homedir(), '.dsh', 'memory')
const REPO = process.env.DSH_MEMORY_BACKUP_DIR || path.join(os.homedir(), 'DeepSeekHarness', 'dsh-memory-data')
const REMOTE = 'https://github.com/zhengshupei-dshhub/dsh-memory-data.git'
const FILES = [
  'memories.json',
  'persona.json',
  'evolution/backlog.jsonl',
  'evolution/journal.jsonl',
]
const JSON_OUT = process.argv.includes('--json')

function say(text) {
  if (!JSON_OUT) console.log(text)
}

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', ...options })
}

function ensureRepo() {
  if (fs.existsSync(path.join(REPO, '.git'))) return false
  fs.mkdirSync(path.dirname(REPO), { recursive: true })
  execFileSync('git', ['clone', REMOTE, REPO], { encoding: 'utf8' })
  return true
}

function ensureIdentity() {
  for (const [key, value] of [['user.name', 'dshhub-backup'], ['user.email', 'backup@localhost']]) {
    try {
      git(['config', key])
    } catch {
      git(['config', key, value])
    }
  }
}

function counts() {
  const out = {}
  try {
    const memories = JSON.parse(fs.readFileSync(path.join(SRC, 'memories.json'), 'utf8'))
    out.memories = (memories.memories ?? memories).length
  } catch {
    out.memories = 0
  }
  try {
    const persona = JSON.parse(fs.readFileSync(path.join(SRC, 'persona.json'), 'utf8'))
    out.diary = (persona.diary ?? []).length
  } catch {
    out.diary = 0
  }
  return out
}

function main() {
  if (!fs.existsSync(SRC)) throw new Error(`记忆目录不存在：${SRC}`)

  ensureRepo()
  ensureIdentity()

  let copied = 0
  for (const rel of FILES) {
    const from = path.join(SRC, rel)
    if (!fs.existsSync(from)) continue
    const to = path.join(REPO, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
    copied += 1
  }
  if (copied === 0) throw new Error('没有可备份的数据文件')

  git(['add', '-A'])
  const staged = git(['diff', '--cached', '--name-only']).trim()
  if (!staged) {
    say(`无变化，跳过（已是最新，${copied} 个文件）`)
    if (JSON_OUT) console.log(JSON.stringify({ ok: true, changed: false, copied }))
    return
  }

  const { memories = 0, diary = 0 } = counts()
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16)
  git(['commit', '-m', `backup: ${stamp}（记忆 ${memories} 条 / 日记 ${diary} 篇）`])
  git(['push', 'origin', 'HEAD:main'])

  const sha = git(['rev-parse', '--short', 'HEAD']).trim()
  say(`已备份并推送：${staged.split('\n').length} 个文件变化，提交 ${sha}（记忆 ${memories} 条 / 日记 ${diary} 篇）`)
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, changed: true, sha, files: staged.split('\n'), memories, diary }))
}

try {
  main()
} catch (error) {
  const text = `备份失败：${error instanceof Error ? error.message : String(error)}`
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: text }))
  else console.error(text)
  process.exit(1)
}
