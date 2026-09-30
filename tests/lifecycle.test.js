import { describe, it, expect } from 'vitest'

import {
  name,
  Config,
  apply,
  resolveCommand,
  resolveArgs,
  resolveCwd,
} from '../lib/index.js'

/** A stand-in for the harness context that records what the plugin registers. */
function fakeCtx() {
  const effects = []
  const logs = []
  return {
    effects,
    logs,
    ctx: {
      effect(fn) {
        effects.push(fn)
        return () => {}
      },
      logger: () => ({
        info: (m) => logs.push(`info: ${m}`),
        error: (m) => logs.push(`error: ${m}`),
      }),
    },
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const runningChild = (config) => ({
  ...Config(config),
  command: process.execPath,
  args: ['-e', 'setInterval(() => {}, 1000)'],
  restartDelayMs: 0,
})

describe('plugin contract', () => {
  it('exposes the required name', () => {
    expect(name).toBe('dsh-desktop-pet')
  })

  it('applies defaults through the Schemastery schema', () => {
    const cfg = Config({})
    expect(cfg.enabled).toBe(true)
    expect(cfg.restartDelayMs).toBe(2000)
    expect(cfg.maxRestarts).toBe(5)
    expect(Array.isArray(cfg.args)).toBe(true)
  })

  it('rejects an invalid config loudly instead of silently defaulting', () => {
    expect(() => Config({ restartDelayMs: 'not-a-number' })).toThrow()
  })

  it('registers exactly one effect, and none at all when disabled', () => {
    const on = fakeCtx()
    apply(on.ctx, runningChild({}))
    expect(on.effects).toHaveLength(1)

    const off = fakeCtx()
    apply(off.ctx, Config({ enabled: false }))
    expect(off.effects).toHaveLength(0)
  })
})

describe('path resolution', () => {
  it('honours explicit overrides', () => {
    const cfg = Config({ command: 'C:/x/e.exe', args: ['--flag'], cwd: 'C:/x' })
    expect(resolveCommand(cfg)).toBe('C:/x/e.exe')
    expect(resolveArgs(cfg)).toEqual(['--flag'])
    expect(resolveCwd(cfg)).toBe('C:/x')
  })

  it('defaults to an electron runtime and the packaged window entry', () => {
    const cfg = Config({})
    expect(resolveCommand(cfg).endsWith('electron.exe')).toBe(true)
    expect(resolveArgs(cfg)).toHaveLength(1)
    expect(resolveArgs(cfg)[0].endsWith('pet-app')).toBe(true)
    // runtime state lives in the DSH home: never the user profile (its NTUSER.DAT
    // lock takes file watchers down) and never inside the package (a running
    // window would hold its own plugin directory, blocking pnpm updates)
    const cwd = resolveCwd(cfg)
    expect(cwd.endsWith('desktop-pet')).toBe(true)
    expect(cwd).not.toContain('node_modules')
  })
})

describe('lifecycle', () => {
  it('starts the pet when activated and kills it on dispose', async () => {
    const { ctx, effects, logs } = fakeCtx()
    apply(ctx, runningChild({}))

    const dispose = effects[0]()
    await sleep(400)

    const started = logs.find((l) => l.includes('pet window started'))
    expect(started).toBeTruthy()
    const pid = Number(started.match(/pid (\d+)/)[1])
    expect(alive(pid)).toBe(true)

    dispose()
    await sleep(500)
    expect(alive(pid)).toBe(false)
  })

  it('restarts after a crash, but not after a clean exit', async () => {
    // crash: exit 1
    const crash = fakeCtx()
    apply(crash.ctx, {
      ...Config({ restartDelayMs: 150, maxRestarts: 2 }),
      command: process.execPath,
      args: ['-e', 'process.exit(1)'],
    })
    const disposeCrash = crash.effects[0]()
    await sleep(900)
    const starts = crash.logs.filter((l) => l.includes('pet window started')).length
    expect(starts).toBeGreaterThan(1)
    disposeCrash()

    // clean exit: code 0 must NOT be restarted (that is the user closing the pet)
    const clean = fakeCtx()
    apply(clean.ctx, {
      ...Config({ restartDelayMs: 100 }),
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
    })
    const disposeClean = clean.effects[0]()
    await sleep(700)
    expect(clean.logs.filter((l) => l.includes('pet window started')).length).toBe(1)
    disposeClean()
  })

  it('reports a missing runtime instead of failing silently', async () => {
    const { ctx, effects, logs } = fakeCtx()
    apply(ctx, Config({ command: 'C:/definitely/not/here.exe' }))
    effects[0]()
    await sleep(200)
    expect(logs.some((l) => l.includes('pet window runtime not found'))).toBe(true)
  })
})
