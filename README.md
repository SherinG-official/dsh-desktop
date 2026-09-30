# dsh-desktop-pet

A desktop pet for DeepSeek Harness: a floating, always-on-top window that shows live token usage and account balance while you work.

[中文](README-zh.md) · [Español](README-es.md) · [हिन्दी](README-hi.md) · [Português](README-pt.md)

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.2.0-rc.2` (desktop profile) |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | Windows (the window host is Electron) |

## What it does

Owns the lifecycle of the pet window as a Host plugin.

A floating window cannot be made from inside the plugin surface: a Client module (`dsh.client`) runs in the harness page, and a Host plugin runs in Node with no Electron APIs. So the window stays its own process and this plugin is what manages it — start on activate, stop on unload, restart after a crash.

The window itself reads its own data and needs nothing from the harness:

| Shown | Source |
|---|---|
| token usage | the engine's own `tokenUsage` projection rows under `<DSH home>/storages/session_projcache/sessions/*.json` |
| balance | the official `GET https://api.deepseek.com/user/balance`, key read from `~/.dsh/.credentials.yaml` in the window process only |

Because the plugin registers through a single `ctx.effect()`, toggling it off in the harness actually stops the pet, and hot-reloading the plugin leaves no orphan process behind.

## Install

```sh
pnpm pack
dsh plugin --profile desktop add ./dsh-desktop-pet-0.1.0.tgz
```

Adding a **directory** path does not register the bundle — it must be a tarball (or an npm/git source). Restart the app afterwards; bundle plugins load at start-up.

The window host is `electron`, installed as a normal dependency. pnpm's build-script gate must allow it — the harness leaves the decision in the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  electron: true
```

## Configuration

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Start the pet window when the plugin activates |
| `command` | string | `''` | Executable that hosts the window. Empty resolves `electron` through the module system, so it works under hoisted and nested linking alike |
| `args` | string[] | `[]` | Arguments for `command`. Empty runs the packaged window entry |
| `cwd` | string | `''` | Working directory for the window process. Empty uses `<plugin>/workspace` — deliberately never the user profile, whose `NTUSER.DAT` lock takes file watchers down |
| `restartDelayMs` | number | `2000` | Delay before restarting after an abnormal exit. `0` disables restarts |
| `maxRestarts` | number | `5` | Consecutive restarts allowed before giving up and logging an error |

Configuration is validated by the Schemastery `Config` schema in `lib/index.js`; no tunable is hardcoded. An invalid value fails loudly at load instead of silently defaulting.

A clean exit (`code 0`) is treated as the user closing the pet on purpose and is never restarted; only abnormal exits count against `maxRestarts`.

## Development

```sh
npm install --ignore-scripts   # skip the electron binary download while iterating
npm test
```

`tests/lifecycle.test.js` drives the real plugin through a stub context: it asserts the effect is registered (and not registered when disabled), that activation starts a child and dispose kills it, that a crash restarts while a clean exit does not, and that a missing runtime is reported rather than swallowed.

## License

[Apache License 2.0](LICENSE) © 2026 dsh-desktop-pet contributors.
