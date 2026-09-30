/**
 * dsh-desktop-pet — the Client half.
 *
 * Loaded as a `dsh.client` bundle (package.json#dsh.client, exported at
 * `./client`), this module puts the pet's controls where someone can actually
 * reach them:
 *
 *   conversation.input.left   a small round button beside the composer that
 *                             shows and hides the pet, and starts it when it is
 *                             not running at all
 *   settings.section          a 「桌宠」 page with the full set: run state,
 *                             show/hide/restart/quit, and the size ladder
 *
 * Both go through the Host plugin's JSON route (`/dsh-desktop-pet`, see
 * ../lib/index.js) rather than talking to the window process directly. The
 * window is a separate program on a loopback port; the Host is what knows
 * whether it is running, where its executable is, and how to start it again.
 *
 * This is a single self-contained file on purpose: the client bundle contract
 * is `window.__ModuleLoader__.load({ id, factory })` with `id` equal to the
 * loader entry name, and only `react` may be required from it.
 */
window.__ModuleLoader__.load({
  id: 'dsh-desktop-pet',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    const API = '/dsh-desktop-pet'
    const DEFAULT_SIZES = [0.75, 1, 1.25, 1.5]
    const POLL_MS = 4000

    const CSS = [
      '.dsh-pet-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border-radius:50%;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);cursor:pointer;flex:none;overflow:hidden;transition:border-color .12s ease,box-shadow .12s ease,opacity .12s ease}',
      '.dsh-pet-btn:hover{border-color:var(--dsw-alias-brand-primary)}',
      '.dsh-pet-btn.on{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent)}',
      '.dsh-pet-btn.off{opacity:.45}',
      '.dsh-pet-btn:disabled{opacity:.4;cursor:default}',
      '.dsh-pet-btn-face{width:22px;height:22px;border-radius:50%;object-fit:cover;pointer-events:none;-webkit-user-drag:none}',
      '.dsh-pet-btn-dot{position:absolute;right:1px;bottom:1px;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-secondary);border:1.5px solid var(--dsw-alias-bg-layer-1);opacity:0;transition:opacity .12s ease}',
      '.dsh-pet-btn.super .dsh-pet-btn-dot{opacity:1;background:#2f9e6b}',
      '.dsh-pet-btn.busy .dsh-pet-btn-face{animation:dsh-pet-spin 1s linear infinite}',
      '@keyframes dsh-pet-spin{0%{transform:scale(.86)}50%{transform:scale(1)}100%{transform:scale(.86)}}',

      '.dsh-pet-panel{display:flex;flex-direction:column;gap:12px;padding:4px 0;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.dsh-pet-panel .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.dsh-pet-panel .section-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.04em;margin:2px 0 -4px}',
      '.dsh-pet-panel .state{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-weight:600}',
      '.dsh-pet-panel .state i{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-secondary);font-style:normal}',
      '.dsh-pet-panel .state.live i{background:#2f9e6b}',
      '.dsh-pet-panel .state.hidden i{background:#e08a2e}',
      '.dsh-pet-panel .state.dead i{background:#d9534f}',
      '.dsh-pet-panel .muted{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.dsh-pet-panel button{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:5px 12px;font-size:13px;cursor:pointer;transition:border-color .12s ease,background .12s ease}',
      '.dsh-pet-panel button:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}',
      '.dsh-pet-panel button:disabled{opacity:.5;cursor:default}',
      '.dsh-pet-panel button.btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.dsh-pet-panel button.btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);border-color:var(--dsw-alias-button-primary-hover)}',
      '.dsh-pet-panel button.danger:hover:not(:disabled){border-color:#e5484d;color:#e5484d}',
      '.dsh-pet-panel button.size{min-width:64px;font-variant-numeric:tabular-nums}',
      '.dsh-pet-panel button.size.on{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);font-weight:600}',
      '.dsh-pet-panel .notice{padding:7px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-pet-panel .notice.bad{border-color:#e5484d;color:#e5484d}',
    ].join('')

    // ------------------------------------------------------------------ state --
    /**
     * One shared snapshot for both surfaces.
     *
     * The poller runs only while something is subscribed, and a publish that
     * changes nothing is dropped: `useSyncExternalStore` compares snapshots by
     * identity, so republishing an equal object every four seconds would wake
     * React for nothing.
     */
    function createStore() {
      let snapshot = {
        loading: true,
        running: false,
        supervised: false,
        visible: false,
        launcher: false,
        pid: null,
        scale: 1,
        sizes: DEFAULT_SIZES,
        note: null,
        error: null,
        busy: null,
      }
      const listeners = new Set()
      let timer = 0
      let inFlight = false

      const same = (a, b) => {
        for (const key of Object.keys(b)) {
          if (key === 'sizes') continue
          if (key === 'lastExit') {
            // a fresh object every poll: compare what it carries, not identity
            const was = a[key] ? `${a[key].code}@${a[key].at}` : ''
            const now = b[key] ? `${b[key].code}@${b[key].at}` : ''
            if (was !== now) return false
            continue
          }
          if (a[key] !== b[key]) return false
        }
        return true
      }

      const publish = (next) => {
        const merged = { ...snapshot, ...next }
        if (same(snapshot, merged)) return
        snapshot = merged
        for (const listener of Array.from(listeners)) {
          try {
            listener()
          } catch {
            /* one broken subscriber must not stop the others */
          }
        }
      }

      const getSnapshot = () => snapshot

      async function request(action, params) {
        const query = new URLSearchParams({ action, ...(params || {}) })
        const response = await fetch(`${API}?${query.toString()}`, { cache: 'no-store' })
        let body = null
        try {
          body = await response.json()
        } catch {
          /* a non-JSON answer means the route is not ours */
        }
        if (!response.ok || !body) {
          throw new Error((body && body.error) || `HTTP ${response.status}`)
        }
        return body
      }

      async function refresh() {
        if (inFlight) return
        inFlight = true
        try {
          publish({ ...(await request('status')), loading: false, error: null })
        } catch (error) {
          publish({ loading: false, error: String((error && error.message) || error) })
        } finally {
          inFlight = false
        }
      }

      async function act(action, params) {
        if (snapshot.busy) return
        publish({ busy: action, note: null })
        try {
          // `show`, `toggle` and `restart` start the window when it is not up,
          // which takes a couple of seconds — that is what `busy` is showing.
          publish({ ...(await request(action, params)), busy: null, loading: false, error: null })
        } catch (error) {
          publish({ busy: null, error: String((error && error.message) || error) })
        }
      }

      const subscribe = (listener) => {
        listeners.add(listener)
        if (listeners.size === 1) {
          refresh()
          timer = setInterval(refresh, POLL_MS)
        }
        return () => {
          listeners.delete(listener)
          if (listeners.size === 0 && timer) {
            clearInterval(timer)
            timer = 0
          }
        }
      }

      return { subscribe, getSnapshot, refresh, act }
    }

    const store = createStore()

    const useSyncExternalStore = typeof React.useSyncExternalStore === 'function'
      ? React.useSyncExternalStore
      : (subscribe, getSnapshot) => {
        const [value, setValue] = React.useState(getSnapshot)
        React.useEffect(() => subscribe(() => setValue(getSnapshot())), [subscribe, getSnapshot])
        return value
      }

    const usePet = () => useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

    // ------------------------------------------------------------------ view ---
    const describe = (state) => {
      if (state.error) return '控制接口不可用'
      if (state.loading) return '读取中…'
      if (!state.running) return '未运行'
      return state.visible ? '显示中' : '已隐藏'
    }

    const level = (state) => {
      if (state.error || !state.running) return 'dead'
      return state.visible ? 'live' : 'hidden'
    }

    function PetIconButton() {
      const state = usePet()
      const label = describe(state)
      const title = `桌宠：${label}${state.pid ? ` · pid ${state.pid}` : ''} · 单击${state.visible ? '隐藏' : '唤出'}`
      const className = [
        'dsh-pet-btn',
        state.visible ? 'on' : '',
        state.running ? '' : 'off',
        state.supervised ? 'super' : '',
        state.busy ? 'busy' : '',
      ].filter(Boolean).join(' ')

      return React.createElement('button', {
        type: 'button',
        className,
        title,
        'aria-label': title,
        disabled: Boolean(state.busy) || Boolean(state.error),
        onClick: () => store.act(state.visible ? 'hide' : 'show'),
      },
        React.createElement('img', {
          className: 'dsh-pet-btn-face',
          src: `${API}?action=icon`,
          alt: '',
          draggable: false,
        }),
        React.createElement('i', { className: 'dsh-pet-btn-dot' }),
      )
    }

    function PetPanel() {
      const state = usePet()
      const sizes = Array.isArray(state.sizes) && state.sizes.length ? state.sizes : DEFAULT_SIZES
      const busy = Boolean(state.busy)
      const running = Boolean(state.running)

      return React.createElement('div', { className: 'dsh-pet-panel' },
        React.createElement('div', { className: 'row' },
          React.createElement('span', { className: `state ${level(state)}` },
            React.createElement('i'),
            state.busy ? '处理中…' : describe(state),
          ),
          state.pid ? React.createElement('span', { className: 'muted' }, `pid ${state.pid}`) : null,
          state.lastExit && !running
            ? React.createElement('span', { className: 'muted' }, `上次退出码 ${state.lastExit.code}`)
            : null,
        ),

        React.createElement('div', { className: 'section-title' }, '控制'),
        React.createElement('div', { className: 'row' },
          React.createElement('button', {
            type: 'button',
            className: 'btn-primary',
            disabled: busy,
            onClick: () => store.act('show'),
          }, '显示桌宠'),
          React.createElement('button', {
            type: 'button',
            disabled: busy || !running || !state.visible,
            onClick: () => store.act('hide'),
          }, '隐藏桌宠'),
          React.createElement('button', {
            type: 'button',
            disabled: busy,
            onClick: () => store.act('restart'),
          }, '重新启动进程'),
          React.createElement('button', {
            type: 'button',
            className: 'danger',
            disabled: busy || !running,
            onClick: () => store.act('stop'),
          }, '退出进程'),
        ),

        React.createElement('div', { className: 'section-title' }, '大小'),
        React.createElement('div', { className: 'row' },
          sizes.map((size) => React.createElement('button', {
            key: String(size),
            type: 'button',
            className: `size${Math.abs((state.scale || 1) - size) < 0.001 ? ' on' : ''}`,
            disabled: busy,
            onClick: () => store.act('scale', { value: String(size) }),
          }, `${Math.round(size * 100)}%`)),
        ),

        state.note ? React.createElement('div', { className: 'notice bad' }, state.note) : null,
        state.error ? React.createElement('div', { className: 'notice bad' }, state.error) : null,

        React.createElement('div', { className: 'notice' },
          '「显示桌宠」在进程已退出时会把整个浮窗重新拉起来。桌宠隐藏后，它的位置上会出现一枚小圆钮，单击即可唤回；右键桌宠或圆钮也能改大小。',
        ),
      )
    }

    // ---------------------------------------------------------------- plugin ---
    const inject = ['slots']

    function apply(ctx) {
      const styleEl = document.createElement('style')
      styleEl.textContent = CSS
      document.head.appendChild(styleEl)
      ctx.effect(() => () => { styleEl.remove() }, 'dsh-desktop-pet: panel styles')

      const slots = ctx.get('slots')
      if (slots === undefined) return

      // Components are created once, outside the render callbacks: a fresh
      // component type on every re-render makes React unmount and remount the
      // subtree, which is how a small button turns into a rebuild storm.
      const IconButton = PetIconButton
      const Panel = PetPanel

      slots.inject('conversation.input.left', () => slots.register(
        { name: 'conversation.input.left', id: 'desktop-pet', order: 6, label: '桌宠' },
        () => React.createElement(IconButton),
      ))

      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'desktop-pet', order: 26, label: '桌宠' },
        () => React.createElement(Panel),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
