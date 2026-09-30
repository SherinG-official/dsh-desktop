'use strict';

/**
 * The desktop pet, as its own Electron application.
 *
 * It was a window inside the main app, which meant every CSS tweak cost a full
 * app restart — and that took the shared engine down with it. Running it as a
 * separate process makes the pet independently restartable, and lets it read
 * everything it shows straight from disk and the public balance endpoint, so it
 * needs nothing from the main app:
 *
 *   token usage -> <dsh home>/storages/session_projcache  (via ./metrics)
 *   balance     -> GET https://api.deepseek.com/user/balance (via ./balance)
 *   art         -> assets/pet/*.png, pushed to the renderer as blob urls
 *
 * It is a single window and a tray-free process: no tray, no menus, no engine.
 * The only thing it needs from outside is "show the main window", which it asks
 * for by connecting to a loopback focus port (see focus-port.js).
 *
 * Three ways to start it, all reaching run() below:
 *   npm run pet                       a dev checkout
 *   electron pet-app --pet --dev      the thin shim in pet-app/
 *   "DSH Desktop.exe" --pet           the installed app, re-launched as the pet
 */

const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const { Metrics } = require('./metrics');
const { Balance } = require('./balance');
const util = require('./util');
const { FOCUS_PORT, PET_CONTROL_PORT } = require('./focus-port');

const ROOT = path.join(__dirname, '..');
const PET_SIZE = { width: 330, height: 440 };
const STATE_FILE = path.join(util.dshHome(), 'desktop', 'pet-window.json');

let metrics;
let balance;
let petWindow = null;
let controlServer = null;

function readState() {
  return util.readJsonSafe(STATE_FILE) || {};
}

function writeState(patch) {
  try {
    const next = { ...readState(), ...patch };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  } catch {
    /* window state is a convenience, never fatal */
  }
}

// --------------------------------------------------------------------- state ---
function snapshot() {
  const tokens = metrics.state;
  const money = balance.state;
  return {
    tokens: {
      session: tokens.liveSession,
      title: tokens.liveTitle,
      totalTokens: tokens.totalTokens,
      input: tokens.totals.uncachedInputTokens,
      output: tokens.totals.outputTokens,
      cacheRead: tokens.totals.cacheReadTokens,
      cacheWrite: tokens.totals.cacheWriteTokens,
      allTimeTokens: tokens.allTimeTokens,
      sessions: tokens.sessions,
      turns: tokens.turns,
      steps: tokens.steps,
      context: tokens.context,
      busy: metrics.isBusy(),
    },
    balance: money,
    compact: {
      tokens: util.compact(tokens.totalTokens),
      allTime: util.compact(tokens.allTimeTokens),
      balance: balance.display,
      contextPercent: tokens.context && tokens.context.contextWindow
        ? Math.round((tokens.context.pressureTokens / tokens.context.contextWindow) * 100)
        : null,
    },
  };
}

function push() {
  const state = snapshot();
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('state:update', state);
    petWindow.setTitle(`DSH 桌宠 · ${state.compact.tokens} tokens · ${state.compact.balance}`);
  }
  return state;
}

// -------------------------------------------------------------------- window ---
/**
 * Where the pet should open.
 *
 * A saved position is only reused when its centre still lands on a monitor that
 * currently exists. Display layouts change — a laptop undocked, a resolution
 * switched — and a remembered spot can end up in the dead space beyond every
 * screen, where the window is technically shown and completely unseeable.
 */
function resolveStartPosition() {
  const saved = readState().bounds;
  const plausible = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    && saved.width >= PET_SIZE.width - 8 && saved.height >= PET_SIZE.height - 8;
  if (plausible) {
    const centre = {
      x: Math.round(saved.x + PET_SIZE.width / 2),
      y: Math.round(saved.y + PET_SIZE.height / 2),
    };
    const area = (screen.getDisplayNearestPoint(centre) || screen.getPrimaryDisplay()).workArea;
    const onScreen = centre.x >= area.x && centre.x < area.x + area.width
      && centre.y >= area.y && centre.y < area.y + area.height;
    if (onScreen) return { x: saved.x, y: saved.y };
  }
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - PET_SIZE.width - 16,
    y: area.y + area.height - PET_SIZE.height - 16,
  };
}

function createPetWindow() {
  const { x, y } = resolveStartPosition();

  petWindow = new BrowserWindow({
    width: PET_SIZE.width,
    height: PET_SIZE.height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    title: 'DSH 桌宠',
    webPreferences: {
      preload: path.join(__dirname, 'pet-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // highest z-order level plus periodic raising: another topmost window (a
  // maximised player, say) otherwise sits above the pet and eats its clicks
  try { petWindow.setAlwaysOnTop(true, 'screen-saver'); } catch { /* older electron */ }

  petWindow.loadFile(path.join(ROOT, 'renderer', 'pet.html'));
  petWindow.once('ready-to-show', () => {
    if (readState().visible !== false) {
      petWindow.showInactive();
      try { petWindow.moveTop(); } catch { /* ignore */ }
    }
  });
  petWindow.on('moved', () => {
    if (petWindow && !petWindow.isDestroyed()) writeState({ bounds: petWindow.getBounds() });
  });
  petWindow.on('closed', () => { petWindow = null; });

  const topGuard = setInterval(() => {
    if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) {
      try { petWindow.moveTop(); } catch { /* ignore */ }
    }
  }, 20000);
  if (typeof topGuard.unref === 'function') topGuard.unref();

  return petWindow;
}

function hidePet() {
  writeState({ visible: false });
  if (petWindow && !petWindow.isDestroyed()) petWindow.hide();
}

/**
 * Bring the pet back — and make it stick.
 *
 * Hiding used to be a one-way door: hidePet() persisted visible:false and the
 * window only ever auto-showed when that flag was not false, so nothing could
 * undo it. A pet started after a hide therefore came up invisible with no way
 * back, which reads exactly like "the pet is broken".
 */
function showPet() {
  writeState({ visible: true });
  if (!petWindow || petWindow.isDestroyed()) return false;

  // the saved spot may no longer exist (monitor unplugged, resolution change),
  // and an off-screen window is indistinguishable from a missing one
  const bounds = petWindow.getBounds();
  const center = {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
  const area = (screen.getDisplayNearestPoint(center) || screen.getPrimaryDisplay()).workArea;
  const fits = bounds.x + bounds.width > area.x && bounds.x < area.x + area.width
    && bounds.y + bounds.height > area.y && bounds.y < area.y + area.height;
  if (!fits) {
    const target = {
      x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - PET_SIZE.width),
      y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - PET_SIZE.height),
      width: PET_SIZE.width,
      height: PET_SIZE.height,
    };
    petWindow.setBounds(target);
    writeState({ bounds: target });
  }

  petWindow.showInactive();
  try { petWindow.moveTop(); } catch { /* ignore */ }
  return true;
}

function petIsVisible() {
  // the window is the truth; the flag alone can be stale
  return Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible());
}

/**
 * Park the pet at the primary display's bottom-right corner and show it.
 * This is the recovery move for "it is running but I cannot find it": whatever
 * display layout the saved position was recorded under, this lands somewhere
 * the user is definitely looking.
 */
function snapToCorner() {
  if (!petWindow || petWindow.isDestroyed()) return false;
  const area = screen.getPrimaryDisplay().workArea;
  const target = {
    x: area.x + area.width - PET_SIZE.width - 12,
    y: area.y + area.height - PET_SIZE.height - 12,
    width: PET_SIZE.width,
    height: PET_SIZE.height,
  };
  petWindow.setBounds(target);
  writeState({ bounds: target });
  showPet();
  return true;
}

// ------------------------------------------------------------ control channel ---
/** One command per connection; replies with a single status line. */
function controlReply(command) {
  switch (command) {
    case 'status': return `pet visible=${petIsVisible() ? 1 : 0}`;
    case 'show':   showPet(); return `pet visible=${petIsVisible() ? 1 : 0}`;
    case 'hide':   hidePet(); return `pet visible=${petIsVisible() ? 1 : 0}`;
    case 'snap':   snapToCorner(); return `pet visible=${petIsVisible() ? 1 : 0}`;
    case 'toggle': if (petIsVisible()) hidePet(); else showPet();
      return `pet visible=${petIsVisible() ? 1 : 0}`;
    case 'quit':   setTimeout(() => app.quit(), 50); return 'pet quitting';
    default:       return 'pet unknown-command';
  }
}

/**
 * Claim PET_CONTROL_PORT, which is also how a duplicate pet is detected.
 *
 * Resolves false when another pet already owns the port. A squatter that does
 * *not* answer like a pet is ignored rather than fatal, so an unrelated program
 * on this port cannot stop the pet from existing.
 */
function claimControlPort() {
  return new Promise((resolve) => {
    controlServer = net.createServer((socket) => {
      let buffered = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        buffered += chunk;
        const end = buffered.indexOf('\n');
        if (end === -1) return;
        const command = buffered.slice(0, end).trim().toLowerCase();
        buffered = buffered.slice(end + 1);
        socket.end(`${controlReply(command)}\n`);
      });
      socket.on('error', () => { /* a dropped probe is not an error */ });
    });

    controlServer.once('error', (error) => {
      if (error.code !== 'EADDRINUSE') {
        console.error(`pet control listener unavailable: ${error.message}`);
        resolve(true);
        return;
      }
      // someone holds the port — ask whether it is one of us
      const probe = net.connect({ host: '127.0.0.1', port: PET_CONTROL_PORT });
      let reply = '';
      const settle = (isPet) => {
        probe.removeAllListeners();
        probe.destroy();
        controlServer = null;
        if (isPet) resolve(false);
        else {
          console.error(`port ${PET_CONTROL_PORT} is held by another program; running without a single-instance lock`);
          resolve(true);
        }
      };
      probe.setTimeout(600);
      probe.once('connect', () => probe.end('status\n'));
      probe.on('data', (chunk) => { reply += chunk; });
      probe.once('end', () => settle(reply.trim().startsWith('pet')));
      probe.once('timeout', () => settle(false));
      probe.once('error', () => settle(false));
    });

    controlServer.listen(PET_CONTROL_PORT, '127.0.0.1', () => resolve(true));
  });
}

// --------------------------------------------------------------- focus relay ---
/** Asks the main app to surface its window. Silent no-op when it is not running. */
function requestMainWindow() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: FOCUS_PORT });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(600);
    socket.once('connect', () => {
      socket.end('focus\n', () => done(true));
    });
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

// ---------------------------------------------------------------------- ipc ----
function registerIpc() {
  ipcMain.handle('state:get', () => snapshot());
  ipcMain.handle('state:refresh', async () => {
    metrics.refresh();
    await balance.refresh();
    return push();
  });

  ipcMain.handle('pet:frames', () => {
    const dir = path.join(ROOT, 'assets', 'pet');
    const frames = {};
    let version = 0;
    for (const name of ['base', 'chew', 'hover']) {
      const file = path.join(dir, `${name}.png`);
      try {
        const buf = fs.readFileSync(file);
        for (const byte of buf) version = (version * 31 + byte) >>> 0;
        frames[name] = `data:image/png;base64,${buf.toString('base64')}`;
      } catch {
        /* a missing frame leaves that expression unavailable */
      }
    }
    return { version: version.toString(36), frames };
  });

  ipcMain.handle('window:show', () => requestMainWindow());

  ipcMain.handle('pet:drag-begin', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      try {
        // pin the size so Windows' snap handling cannot resize the pet mid-drag
        petWindow.setMinimumSize(PET_SIZE.width, PET_SIZE.height);
        petWindow.setMaximumSize(PET_SIZE.width, PET_SIZE.height);
      } catch { /* ignore */ }
    }
    return true;
  });

  ipcMain.handle('pet:drag-end', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      try {
        petWindow.setMinimumSize(1, 1);
        petWindow.setMaximumSize(0, 0);
        petWindow.setBounds({ ...petWindow.getBounds(), ...PET_SIZE });
      } catch { /* ignore */ }
    }
    return true;
  });

  ipcMain.handle('pet:move-to', (_event, point) => {
    if (!petWindow || petWindow.isDestroyed()) return false;
    const x = point ? Number(point.x) : NaN;
    const y = point ? Number(point.y) : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    // move WITH the size: Windows can resize a window it sees being repositioned
    petWindow.setBounds({
      x: Math.round(x), y: Math.round(y), width: PET_SIZE.width, height: PET_SIZE.height,
    });
    return true;
  });

  /** Only writes when the pet is genuinely outside: setBounds can nudge by a pixel. */
  ipcMain.handle('pet:clamp', () => {
    if (!petWindow || petWindow.isDestroyed()) return null;
    const bounds = petWindow.getBounds();
    const center = {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    };
    const area = (screen.getDisplayNearestPoint(center) || screen.getPrimaryDisplay()).workArea;
    const right = area.x + area.width - PET_SIZE.width;
    const bottom = area.y + area.height - PET_SIZE.height;
    if (bounds.x >= area.x && bounds.y >= area.y && bounds.x <= right + 2 && bounds.y <= bottom + 2) {
      return bounds;
    }
    const target = {
      x: Math.min(Math.max(bounds.x, area.x), right),
      y: Math.min(Math.max(bounds.y, area.y), bottom),
      width: PET_SIZE.width,
      height: PET_SIZE.height,
    };
    petWindow.setBounds(target);
    writeState({ bounds: petWindow.getBounds() });
    return target;
  });

  ipcMain.handle('pet:snap', () => {
    if (!petWindow || petWindow.isDestroyed()) return false;
    const bounds = petWindow.getBounds();
    const center = {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    };
    const area = (screen.getDisplayNearestPoint(center) || screen.getPrimaryDisplay()).workArea;
    const target = {
      x: area.x + area.width - PET_SIZE.width - 12,
      y: area.y + area.height - PET_SIZE.height - 12,
      width: PET_SIZE.width,
      height: PET_SIZE.height,
    };
    const same = bounds.x === target.x && bounds.y === target.y
      && bounds.width === target.width && bounds.height === target.height;
    if (!same) petWindow.setBounds(target);
    writeState({ bounds: target });
    return true;
  });

  ipcMain.handle('pet:menu', () => {
    const menu = Menu.buildFromTemplate([
      { label: '打开 DeepSeek Harness', click: () => requestMainWindow() },
      { label: '刷新用量与余额', click: () => { metrics.refresh(); balance.refresh(); push(); } },
      { type: 'separator' },
      { label: '隐藏桌宠', click: hidePet },
      { label: '显示在右下角', click: () => snapToCorner() },
      { type: 'separator' },
      { label: '退出桌宠', click: () => app.quit() },
    ]);
    menu.popup({ window: petWindow });
    return true;
  });
}

// ------------------------------------------------------------------ lifecycle --
/** Entry point, called from src/main.js when the app is launched with --pet. */
function run() {
  app.whenReady().then(async () => {
    app.commandLine.appendSwitch('disable-background-timer-throttling');

    // Claim the control port *before* building anything: the pet is spawned on
    // every app start and outlives the app, so without this lock they pile up,
    // each one an extra invisible window holding its own metrics poller.
    const claimed = await claimControlPort();
    if (!claimed) {
      console.log('a pet is already running; this one is exiting');
      app.exit(0);
      return;
    }

    metrics = new Metrics();
    metrics.refresh();
    balance = new Balance({ onUpdate: () => push() });
    balance.start();

    registerIpc();
    createPetWindow();

    const poll = setInterval(() => {
      metrics.refresh();
      push();
    }, 5000);
    if (typeof poll.unref === 'function') poll.unref();

    push();
  });

  app.on('window-all-closed', () => app.quit());   // the pet IS the window
  app.on('will-quit', () => {
    if (balance) balance.stop();
    if (controlServer) {
      try { controlServer.close(); } catch { /* already closed */ }
      controlServer = null;
    }
  });
}

module.exports = { run };
