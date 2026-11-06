#!/usr/bin/env node
/**
 * 插件版本同步：源码比装的新时，自动重装并重启 DSH。
 *
 * 背景：本地三个插件都是从 GitHub 安装的「真目录」，改了源码不重装，
 * 跑的还是旧版本（2026-11 被坑了三次）。selfcheck 已经能报警告，
 * 这个脚本负责真正把版本追上，并在所有人都休息的时段重启生效。
 *
 * 用法：
 *   node sync.mjs            只检查、打印计划（默认，不动任何东西）
 *   node sync.mjs --apply    真的重装（用 pnpm pack + add，不依赖网络）
 *   node sync.mjs --apply --restart   重装后重启 DSH（凌晨自动化用的组合）
 *
 * 退出码：0 无需更新或已处理；1 出错。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()
const PROFILE = process.env.DSH_PROFILE_DIR || path.join(HOME, '.dsh', 'profiles', 'desktop')
const PNPM =
  process.env.DSH_PNPM ||
  '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs'
const APPLY = process.argv.includes('--apply')
const RESTART = process.argv.includes('--restart')
const LOG_DIR = path.join(HOME, 'DeepSeekHarness', 'dsh-automation', 'plugin-update')
const LOG_FILE = path.join(LOG_DIR, 'last-run.log')

const PLUGINS = [
  { name: 'dsh-memory', repo: path.join(HOME, 'DeepSeekHarness', 'dsh-memory') },
  { name: 'dsh-dafeiyu', repo: path.join(HOME, 'DeepSeekHarness', 'dsh-dafeiyu') },
  // dsh-doubao 已废弃（平台 API key 被删、工具全部 401），2026-11-06 从同步清单移除，
  // 避免 04:00 自动同步又把它装回来。
]

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

function versionOf(dir) {
  return readJson(path.join(dir, 'package.json'))?.version
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5 * 60 * 1000 })
}

function stamp() {
  return new Date().toISOString()
}

function main() {
  const log = []
  const pending = []

  for (const plugin of PLUGINS) {
    const installedDir = path.join(PROFILE, 'node_modules', plugin.name)
    const repoVersion = versionOf(plugin.repo)
    const installedVersion = versionOf(installedDir)
    if (!repoVersion) {
      log.push(`· ${plugin.name}: 源码缺失，跳过`)
      continue
    }
    if (!installedVersion) {
      log.push(`· ${plugin.name}: 未安装（源码 ${repoVersion}）`)
      pending.push({ ...plugin, repoVersion, installedVersion: undefined })
      continue
    }
    if (repoVersion === installedVersion) {
      log.push(`· ${plugin.name}: ${installedVersion} 已是最新`)
      continue
    }
    log.push(`! ${plugin.name}: 源码 ${repoVersion} > 已装 ${installedVersion}`)
    pending.push({ ...plugin, repoVersion, installedVersion })
  }

  if (!pending.length) {
    finish(log, '无需更新')
    return
  }

  if (!APPLY) {
    log.push('')
    log.push(`计划：重装 ${pending.length} 个插件（加 --apply 执行，加 --restart 顺带重启）`)
    finish(log, '仅检查')
    return
  }

  let failed = false
  for (const item of pending) {
    try {
      // 本机打包再安装：不依赖 GitHub 网络，也避免 link 安装导致客户端插件不被扫描。
      const packed = run(process.execPath, [PNPM, 'pack', '--pack-destination', LOG_DIR], item.repo).trim().split('\n').pop()
      const tgz = path.join(LOG_DIR, path.basename(packed.trim()))
      if (!fs.existsSync(tgz)) throw new Error(`打包产物不存在：${tgz}`)
      run(process.execPath, [PNPM, 'add', tgz], PROFILE)
      const nowInstalled = versionOf(path.join(PROFILE, 'node_modules', item.name))
      log.push(`✔ ${item.name}: ${item.installedVersion ?? '未装'} → ${nowInstalled}`)
    } catch (error) {
      failed = true
      log.push(`✖ ${item.name}: 重装失败 — ${error?.message ?? error}`)
    }
  }

  if (failed) {
    finish(log, '有失败')
    process.exitCode = 1
    return
  }

  if (RESTART) {
    log.push('重启 DSH 使新版本生效…')
    finish(log, '已重装')
    restartDSH()
  } else {
    log.push('已重装，重启后生效（加 --restart 可自动重启）')
    finish(log, '已重装')
  }
}

function finish(log, title) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
  const text = [`[${stamp()}] ${title}`, ...log].join('\n')
  fs.appendFileSync(LOG_FILE, text + '\n\n')
  console.log(text)
}

function restartDSH() {
  try {
    execFileSync('osascript', ['-e', 'tell application "DeepSeek Harness" to quit'], { timeout: 30_000 })
  } catch {}
  // 给它时间收尾，再拉起来。
  const until = Date.now() + 15_000
  while (Date.now() < until) {
    try {
      execFileSync('pgrep', ['-f', 'DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'], { stdio: 'ignore' })
      execFileSync('sleep', ['1'])
    } catch {
      break
    }
  }
  try {
    execFileSync('open', ['-a', 'DeepSeek Harness'], { timeout: 30_000 })
  } catch (error) {
    console.error(`重启失败：${error?.message ?? error}`)
    process.exitCode = 1
  }
}

main()
