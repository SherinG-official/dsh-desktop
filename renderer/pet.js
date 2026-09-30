'use strict';

/**
 * Pet renderer.
 *
 * Three expressions drive the look: the resting face (`base`), the chewing face
 * (`chew`) used while the agent is working, and the grin (`hover`) under the
 * cursor. Body and topknot are the same art on two clipped layers so the ahoge
 * can sway independently, and a click plays a squash-and-stretch.
 *
 * Dragging moves the window through the bridge; because the bubble lives in the
 * same window and is positioned in window coordinates, it cannot drift away from
 * the character.
 */

const api = window.dsh;

const pet = document.getElementById('pet');
const bubble = document.getElementById('bubble');
const bubbleTitle = document.getElementById('bubbleTitle');
const badge = document.getElementById('badge');
const sessionTokens = document.getElementById('sessionTokens');
const allTimeTokens = document.getElementById('allTimeTokens');
const balanceValue = document.getElementById('balance');
const ctxBar = document.getElementById('ctxBar');
const ctxFill = document.getElementById('ctxFill');

const LOW_BALANCE = 10;   // CNY

// frames arrive as base64 and become blob urls: a fresh key every load, so
// regenerated art can never be masked by a reused decode-cache entry
const FRAMES = { base: null, chew: null, hover: null };
const IMAGES = {
  bodyBase: document.getElementById('bodyBase'),
  bodyChew: document.getElementById('bodyChew'),
  knotBase: document.getElementById('knotBase'),
  knotChew: document.getElementById('knotChew'),
};

let currentFace = null;
let hovered = false;
let lastState = null;
let chewing = false;
let chewTimer = null;
// identity of the newest in-flight swap per layer, so an older one can bow out
const PENDING = {};

function faceFor(state) {
  if (hovered) return 'hover';
  if (state && state.tokens && state.tokens.busy) return 'chew';
  return 'base';
}

/** Swaps the drawn expression. New elements are used per change so a stale
 *  decode can never keep painting the previous face. */
function swapImage(key, url) {
  const current = IMAGES[key];
  if (!current || !url) return;
  const next = current.cloneNode(false);
  next.removeAttribute('src');

  // A second swap can begin while this one is still decoding — hovering in and
  // straight back out does it. Hand every swap an identity so the superseded one
  // stands down, and only ever publish a node that actually reached the document:
  // the previous version wrote IMAGES[key] from the *stale* captured node, so a
  // swap that lost the race left the slot pointing at a detached element, after
  // which replaceChild silently no-opped and the face could never change again.
  const token = {};
  PENDING[key] = token;
  next.addEventListener('load', () => {
    if (PENDING[key] !== token) return;      // a newer swap already won
    const live = IMAGES[key];                // read fresh: it may have moved on
    if (live && live.parentNode) live.parentNode.replaceChild(next, live);
    IMAGES[key] = next;
  }, { once: true });

  next.src = url;
}

function setFace(face) {
  if (!FRAMES[face] || face === currentFace) return;
  currentFace = face;
  const url = FRAMES[face];
  swapImage('bodyBase', url);
  swapImage('knotBase', url);
  // the chewing mouth always comes from the `chew` art, whatever the base face is
  swapImage('bodyChew', FRAMES.chew);
  swapImage('knotChew', FRAMES.chew);
}

/** Chewing is a mouth swap at a steady rhythm while the agent is working. */
function setChewing(on) {
  if (on === chewing) return;
  chewing = on;
  if (chewTimer) {
    clearInterval(chewTimer);
    chewTimer = null;
  }
  if (!on) {
    pet.dataset.chew = 'off';
    return;
  }
  pet.dataset.chew = 'on';
  chewTimer = setInterval(() => {
    pet.dataset.chew = pet.dataset.chew === 'on' ? 'off' : 'on';
  }, 240);
}

function render(state) {
  if (!state) return;
  lastState = state;

  const { tokens, balance, compact } = state;
  const busy = Boolean(tokens.busy);
  const lowMoney = balance && balance.ok && Number.isFinite(balance.total) && balance.total < LOW_BALANCE;
  const moneyBroken = balance && !balance.ok;

  const face = faceFor(state);
  setFace(face);
  setChewing(busy && !hovered);
  pet.dataset.state = busy ? 'busy' : (hovered ? 'hover' : 'idle');
  badge.hidden = !busy;

  document.body.classList.toggle('show-bubble', hovered || busy);

  bubbleTitle.textContent = busy ? '正在干活…' : (tokens.title || '在想事情…');
  sessionTokens.textContent = `${compact.tokens} tokens`;
  sessionTokens.title = `输入 ${tokens.input} · 输出 ${tokens.output} · 缓存读 ${tokens.cacheRead}`;
  allTimeTokens.textContent = `${compact.allTime} · ${tokens.sessions} 会话`;

  if (balance && balance.ok) {
    balanceValue.textContent = compact.balance;
    balanceValue.className = `v ${lowMoney ? 'warn' : 'good'}`;
    balanceValue.title = `充值 ${balance.toppedUp?.toFixed(2)} · 赠送 ${balance.granted?.toFixed(2)}`;
  } else if (moneyBroken) {
    balanceValue.textContent = '—';
    balanceValue.className = 'v bad';
    balanceValue.title = balance.error || '余额未知';
  }

  if (compact.contextPercent != null) {
    const percent = Math.min(100, Math.max(0, compact.contextPercent));
    ctxBar.hidden = false;
    ctxFill.style.width = `${percent}%`;
    ctxFill.className = percent > 85 ? 'bad' : percent > 65 ? 'warn' : '';
    ctxBar.title = `上下文占用 ${percent}%`;
  } else {
    ctxBar.hidden = true;
  }
}

// ------------------------------------------------------------------ gestures --
let dragging = false;
let moved = 0;
// offset from the window's top-left to the grabbed point, in screen pixels
let grab = { x: 0, y: 0 };
let pending = null;
let frameRequested = false;

document.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 && event.button != null) return;
  dragging = true;
  moved = 0;
  grab = { x: event.screenX - window.screenX, y: event.screenY - window.screenY };
  document.body.classList.add('dragging');
  // tell the main process a drag started, so it can police the window's size
  try { const r = api.dragBegin(); if (r && r.catch) r.catch(() => {}); } catch { /* ignore */ }
  // keep receiving moves even when the cursor leaves this small window
  if (document.body.setPointerCapture) {
    try { document.body.setPointerCapture(event.pointerId); } catch { /* ignore */ }
  }
});

document.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  moved += Math.abs(event.movementX || 0) + Math.abs(event.movementY || 0);

  // Move on the next frame at most: dragging a transparent window is expensive,
  // and the compositor needs the chance to keep the bubble in step with the art.
  pending = { x: event.screenX, y: event.screenY };
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    if (!pending) return;
    const point = pending;
    pending = null;
    // The window is positioned so the grabbed point stays exactly under the
    // cursor. It is deliberately NOT clamped to the work area here: clamping
    // mid-drag stalls the window at a screen edge while the cursor keeps going,
    // which makes the character slide out from under the pointer.
    const x = Math.round(point.x - grab.x);
    const y = Math.round(point.y - grab.y);
    try {
      // A failed frame must never escape as an unhandled rejection: that killed
      // the whole renderer once, which made the window refuse to open at all.
      const result = api.moveTo(x, y);
      if (result && typeof result.catch === 'function') result.catch(reportDragError);
    } catch (error) {
      reportDragError(error);
    }
  });
});

let dragErrorReported = false;
function reportDragError(error) {
  if (dragErrorReported) return;
  dragErrorReported = true;
  try { console.error('pet drag failed:', (error && error.message) || String(error)); } catch { /* ignore */ }
}

function endDrag(event) {
  if (!dragging) return;
  dragging = false;
  pending = null;
  document.body.classList.remove('dragging');
  try { const r = api.dragEnd(); if (r && r.catch) r.catch(() => {}); } catch { /* ignore */ }
  // snap back into the work area now that the gesture is over
  try {
    const result = api.clamp();
    if (result && typeof result.catch === 'function') result.catch(reportDragError);
  } catch (error) {
    reportDragError(error);
  }
  // Only a primary-button press that barely moved counts as a click. Pointer
  // events always carry `button`; it is absent only on synthesized ones, which
  // are treated as primary so scripted drags still click.
  const isPrimary = typeof event.button === 'number' ? event.button === 0 : true;
  if (moved < 6 && isPrimary) {
    squash();
    api.snap();
  }
}

document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

function squash() {
  pet.dataset.squash = 'off';
  // restart the animation reliably
  void pet.offsetWidth;
  pet.dataset.squash = 'on';
  setTimeout(() => { pet.dataset.squash = 'off'; }, 460);
}

document.addEventListener('dblclick', () => api.showWindow());
document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  api.menu();
});

document.addEventListener('pointerenter', () => {
  hovered = true;
  if (lastState) render(lastState);
});
document.addEventListener('pointerleave', () => {
  hovered = false;
  if (lastState) render(lastState);
});

// ------------------------------------------------------------------- startup --
function toBlobUrl(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
}

async function loadFrames() {
  try {
    const payload = await api.frames();
    const map = (payload && payload.frames) || payload || {};
    for (const name of Object.keys(FRAMES)) {
      const base64 = map[name];
      if (!base64) continue;
      const url = toBlobUrl(base64.includes(',') ? base64.split(',')[1] : base64);
      if (FRAMES[name]) URL.revokeObjectURL(FRAMES[name]);
      FRAMES[name] = url;
    }
    currentFace = null;   // force a redraw with the fresh art
  } catch {
    /* the panel still renders without art */
  }
  if (lastState) render(lastState);
}

api.onState(render);
loadFrames();
api.getState().then(render).catch(() => {});
setInterval(() => api.refresh().then(render).catch(() => {}), 15000);
setInterval(() => loadFrames().catch(() => {}), 60000);
