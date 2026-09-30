import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, appendFileSync, openSync, closeSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-desktop-pet'

// lib/ sits one level below the package root, and everything this plugin ships
// (window entry, renderer, art) is addressed from the package root
const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const require = createRequire(import.meta.url)

// The harness gives plugins a logger, but whether its output is reachable
// depends on how the host was launched — and when a plugin silently fails to
// activate there is otherwise nothing to inspect. Append to a fixed file so the
// plugin's own view of its lifecycle survives regardless of the host's logging.
const TRACE_FILE = path.join(
  process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh'),
  'desktop-pet-plugin.log',
)

function trace(message) {
  try {
    appendFileSync(TRACE_FILE, `${new Date().toISOString()} ${message}\n`)
  } catch {
    /* tracing must never break the plugin */
  }
}

trace(`module loaded (node ${process.version}, electron=${process.versions.electron || 'no'}, packaged=${process.versions.electron ? 'yes' : 'no'})`)

/**
 * The desktop pet, as a DSH Host plugin.
 *
 * Why a plugin instead of a standalone app
 * ----------------------------------------
 * The pet needs a floating, always-on-top, transparent, draggable window. The
 * plugin surface cannot make one: a Client module (`dsh.client`) runs inside the
 * harness page, and a Host plugin runs in Node with no Electron APIs. So the
 * window stays its own process, and this plugin is what owns it — the plugin
 * manages lifecycle, configuration and installation, the window process does the
 * drawing.
 *
 * Lifecycle
 * ---------
 * The pet is started when the plugin activates and stopped when it unloads, as a
 * single `ctx.effect()` with one disposer. That is the contract (registration is
 * an effect) and it is also what makes the pet behave: toggling the plugin off in
 * the harness actually stops the pet, and hot-reloading the plugin does not leave
 * an orphan behind.
 *
 * A companion process is normally expected to exit, so a non-zero exit or an
 * unexpected early exit restarts it after `restartDelayMs` — a crash loop costs
 * one pet, not the whole feature. `quit` (the pet's own "退出桌宠") is
 * distinguished from a crash and never restarted.
 */

export const Config = Schema.object({
  enabled: Schema.boolean()
    .default(true)
    .description('是否在插件激活时拉起桌宠浮窗。'),
  command: Schema.string()
    .default('')
    .description('启动浮窗的可执行文件。留空则用随插件安装的 electron。'),
  args: Schema.array(Schema.string())
    .default([])
    .description('传给 command 的参数。留空则用内置的浮窗入口。'),
  cwd: Schema.string()
    .default('')
    .description('浮窗进程的工作目录。留空则用 <DSH 主目录>/desktop-pet（不放插件包内，否则运行中的浮窗会锁住包目录、导致插件无法更新；也不放用户主目录，那里的 NTUSER.DAT 锁会让监视器挂掉）。'),
  restartDelayMs: Schema.number()
    .default(2000)
    .description('浮窗异常退出后重新拉起的延迟（毫秒）。设为 0 表示退出后不再拉起。'),
  maxRestarts: Schema.number()
    .default(5)
    .description('连续异常退出的次数上限，超过后停止重启并记录一次错误。'),
  scale: Schema.number()
    .default(1)
    .description('桌宠初始缩放比例，0.5–2（常用 0.75 / 1 / 1.25 / 1.5）。这是首次启动的初值：之后在桌宠或右下角小圆钮上右键选「桌宠大小」即可随时调整，调整结果会被记住并覆盖此值。'),
})

/**
 * Resolves the executable that hosts the pet window.
 *
 * Electron is never at a fixed relative path here: the profile installs with
 * `nodeLinker: hoisted`, so a plugin's dependency lands in the profile's own
 * node_modules rather than a nested one. Resolving through the module system
 * finds it wherever the linker actually put it.
 */
export function resolveCommand(config) {
  if (config.command) return config.command

  // A runtime installed outside pnpm wins, when one is present.
  //
  // pnpm's side-effects cache is unreliable for electron here: the postinstall
  // result fails to upload, leaving a partial "already built" record that every
  // later install replays — the dist comes back missing electron.exe (and a few
  // other large files), and the window cannot start. An npm-installed runtime in
  // the DSH home is not touched by profile installs, so preferring it makes the
  // pet survive any number of plugin installs.
  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
  const stable = path.join(home, 'desktop-pet-runtime', 'node_modules', 'electron', 'dist', 'electron.exe')
  if (existsSync(stable)) return stable

  // Otherwise walk the directories by hand. Inside Electron-as-Node every module
  // lookup misleads: `require('electron')` yields the Electron API object, not a
  // path, and `require.resolve('electron')` matches the built-in module rather
  // than anything on disk — while the npm package's own `exports` map rejects
  // `electron/package.json`. Directory walking is the only lookup that behaves
  // identically under hoisted and nested linking, and it needs no module system.
  //
  // Two shapes have to be tested at each level: an ancestor may be a package root
  // (`<root>/node_modules/electron`) or already be a node_modules directory, which
  // is exactly what the parent of an installed plugin is (`<root>/node_modules`
  // then `electron` directly — appending node_modules again looks for
  // node_modules/node_modules and silently misses it).
  let dir = HERE
  for (let depth = 0; depth < 8; depth += 1) {
    const nested = path.join(dir, 'node_modules', 'electron', 'dist', 'electron.exe')
    if (existsSync(nested)) return nested
    const sibling = path.join(dir, 'electron', 'dist', 'electron.exe')
    if (existsSync(sibling)) return sibling
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  try {
    // a plain Node process (tests, CLI) can still answer directly
    const resolved = require('electron')
    if (typeof resolved === 'string' && existsSync(resolved)) return resolved
  } catch {
    /* nothing resolvable: the caller reports it */
  }
  return path.join(HERE, 'node_modules', 'electron', 'dist', 'electron.exe')
}

/** Resolves the argument list handed to that executable. */
export function resolveArgs(config) {
  if (config.args.length > 0) return config.args
  return [path.join(HERE, 'pet-app')]
}

/**
 * Working directory for the window process.
 *
 * Never the user profile — its NTUSER.DAT lock takes file watchers down — and
 * never inside the plugin package either: the running window holds its cwd open,
 * which makes the package directory unrenamable and permanently blocks pnpm from
 * updating the plugin (ERR_PNPM_EPERM renaming dsh-desktop-pet_tmp_* on the next
 * install). The DSH home is the right place for a plugin's runtime state.
 */
export function resolveCwd(config) {
  if (config.cwd) return config.cwd
  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
  return path.join(home, 'desktop-pet')
}

export function apply(ctx, config) {
  trace(`apply called (enabled=${config.enabled})`)
  if (!config.enabled) {
    ctx.logger?.('dsh-desktop-pet')?.info?.('disabled by configuration; no pet started')
    return
  }

  ctx.effect(() => {
    const log = ctx.logger?.('dsh-desktop-pet') ?? console
    let child = null
    let timer = null
    let stopping = false
    let restarts = 0

    const stopChild = () => {
      if (!child) return
      const dying = child
      child = null
      try {
        dying.kill()
      } catch {
        /* already gone */
      }
    }

    const start = () => {
      if (stopping) return
      const command = resolveCommand(config)
      trace(`start: command=${command} exists=${existsSync(command)} cwd=${resolveCwd(config)}`)
      if (!existsSync(command)) {
        log.error?.(`pet window runtime not found: ${command}`)
        return
      }

      // The working directory must exist before spawn: a missing cwd makes spawn
      // fail with ENOENT, which reads exactly like "the executable is missing".
      const cwd = resolveCwd(config)
      try {
        mkdirSync(cwd, { recursive: true })
      } catch (error) {
        log.error?.(`cannot prepare the pet working directory ${cwd}: ${error?.message ?? error}`)
        return
      }

      // The window's own output goes to a file rather than nowhere: a crash loop
      // is otherwise silent, and a pet that exits non-zero two seconds after
      // starting is exactly the case where the reason matters most.
      let sink = 'ignore'
      try {
        sink = openSync(path.join(cwd, 'pet-window.log'), 'a')
      } catch {
        /* fall back to discarding output */
      }

      // The host itself runs as Electron-as-Node, so its environment carries
      // ELECTRON_RUN_AS_NODE=1. Inheriting that would launch the window host as
      // a plain Node process — no `app`, no BrowserWindow, and a crash that only
      // shows up as "Cannot read properties of undefined (reading 'whenReady')".
      // The window must be a real Electron app, so the flag is stripped.
      //
      // DSH_PET_SCALE is the window's *initial* size. The user can change it from
      // the pet's own menu, and that choice is remembered in the window state
      // file, which the window reads first — so a later config change here does
      // not yank the size out from under someone who already picked one.
      const childEnv = {
        ...process.env,
        DSH_PET_CHILD: '1',
        DSH_PET_SCALE: String(config.scale),
      }
      delete childEnv.ELECTRON_RUN_AS_NODE

      let proc
      try {
        proc = spawn(command, resolveArgs(config), {
          cwd,
          detached: true,
          stdio: ['ignore', sink, sink],
          // the pet is a GUI process: no console should ever appear for it
          windowsHide: true,
          env: childEnv,
        })
      } catch (error) {
        log.error?.(`failed to start the pet window: ${error?.message ?? error}`)
        return
      }
      if (typeof sink === 'number') {
        try { closeSync(sink) } catch { /* the child holds the handle now */ }
      }

      child = proc
      // Report success only once the process really exists. spawn() returns
      // immediately and reports failure asynchronously, so logging here would
      // claim a pid of `undefined` for a launch that never happened.
      proc.once('spawn', () => {
        log.info?.(`pet window started (pid ${proc.pid})`)
      })
      proc.on('error', (error) => {
        if (child === proc) child = null
        log.error?.(`pet window error: ${error?.message ?? error}`)
      })
      proc.on('exit', (code) => {
        if (child === proc) child = null
        if (stopping) return
        if (code === 0) {
          // a clean exit is the user closing the pet on purpose
          return
        }
        if (config.restartDelayMs <= 0) return
        if (restarts >= config.maxRestarts) {
          log.error?.(`pet window exited ${config.maxRestarts} times; giving up`)
          return
        }
        restarts += 1
        timer = setTimeout(start, config.restartDelayMs)
      })
      proc.unref()
    }

    start()

    return () => {
      stopping = true
      if (timer) clearTimeout(timer)
      timer = null
      stopChild()
    }
  })
}
