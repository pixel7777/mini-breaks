// Mini Breaks — Cycle 02 application module.
// Tabs: Breaks (playlists + habits + tasks) · News & Shopping · Journal (+ tarot).
// Layout/config + daily checkboxes live in localStorage (local-first, per Vision);
// journal, topics, digest, and tarot live in Cloudflare KV via /api/data/*.

import { drawReading } from './tarot-core.js';
import {
  normalizeState, partitionItems, togglePin, dismiss, dismissAllUnpinned, mergeState,
} from './news-core.js';

(function () {
'use strict';

const PREFIX = 'mini-breaks:';
const CONFIG_KEY = PREFIX + 'config';
const STATE_KEY = PREFIX + 'state';
const UI_KEY = PREFIX + 'ui';
const JOURNAL_LOCAL_KEY = PREFIX + 'journal-local';
const TOPICS_LOCAL_KEY = PREFIX + 'topics-local';
const NEWS_STATE_LOCAL_KEY = PREFIX + 'news-state-local';

const GROUP_COLORS = ['#2a9d8f', '#5a8fc4', '#9c6bb8', '#c45a8f', '#c4744f', '#b0822e', '#6ba86b', '#8a8f94'];

const MOODS = [
  { value: 1, emoji: '😞', label: 'Rough' },
  { value: 2, emoji: '😕', label: 'Meh' },
  { value: 3, emoji: '😐', label: 'Okay' },
  { value: 4, emoji: '🙂', label: 'Good' },
  { value: 5, emoji: '😄', label: 'Great' },
];

const PROMPTS = [
  'What made you smile today?',
  'What is taking up most of your headspace right now?',
  'What would make today feel like a win?',
  'What are you grateful for at this exact moment?',
  'What did you learn (or relearn) today?',
  'What is something you handled better than you would have a year ago?',
  'What do you want to remember about today?',
  'What is one small thing you are looking forward to?',
  'If today had a title, what would it be?',
  'What drained you today, and what refilled you?',
  'What did the writing (or the code) teach you today?',
  'What would you tell a friend who had your day?',
  'What is quietly going well?',
  'Where did you feel most like yourself today?',
  'What deserves to be let go of before tomorrow?',
  'What tiny luxury would improve this week?',
];

const DEFAULT_CONFIG = {
  version: 2,
  tiles: [
    { id: 't-chair-stretch', label: 'Chair Stretch', url: 'https://www.youtube-nocookie.com/embed/PFqs_pb52Kk?list=PL66gc-1mx8BCUokovPj-nLeXgZBdb2uRi' },
    { id: 't-chair-exercise', label: 'Chair Exercise', url: 'https://www.youtube-nocookie.com/embed/EAat9edX4h0?list=PL66gc-1mx8BC1v_MseLylA5hvv9bIlTU8' },
    { id: 't-mini-meditate', label: 'Mini Meditate', url: 'https://www.youtube-nocookie.com/embed/inpok4MKVLM?list=PL66gc-1mx8BAi7B6eu46cfNqfpEydptdj' },
    { id: 't-deskdweller-rehab', label: 'Deskdweller Rehab', url: 'https://www.youtube-nocookie.com/embed/6lJBZCRlFnI?list=PL66gc-1mx8BBY-sg8VXiD68Twy-qaIxGE' },
    { id: 't-snoring-exercise', label: 'Snoring Exercise', url: 'https://www.youtube-nocookie.com/embed/DGrw47GYwF0?list=PL66gc-1mx8BBbPMJGi524UsgM99kMNjN8' },
    { id: 't-face-exercise', label: 'Face Exercise', url: 'https://www.youtube-nocookie.com/embed/oJIk2PyukjY?list=PL66gc-1mx8BCaM7I8wt7d2fx5kOhVW79F' },
    { id: 't-voice-exercise', label: 'Voice Exercise', url: 'https://www.youtube-nocookie.com/embed/Xa72p_Qdbm8?list=PL66gc-1mx8BBNgclC1cKYSYZJ3JRo8mgJ' },
    { id: 't-placeholder-1', label: 'Placeholder', url: '' },
    { id: 't-placeholder-2', label: 'Placeholder', url: '' },
  ],
  habits: [
    { id: 's-morning-routine', label: 'Morning Routine', count: 1 },
    { id: 's-daily-page', label: 'Daily Page', count: 1 },
    { id: 's-stand-and-stretch', label: 'Stand and Stretch', count: 3 },
    { id: 's-hydrate', label: 'Hydrate', count: 3 },
    { id: 's-croatian-lesson', label: 'Croatian Lesson', count: 3 },
    { id: 's-do-a-chore', label: 'Do a Chore', count: 1 },
    { id: 's-journal', label: 'Journal', count: 1 },
  ],
  tasks: [],
  groups: [],
};

// ─────────────────────────── storage + migration ───────────────────────────

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

function migrateConfig(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.version === 2 && Array.isArray(parsed.tiles) && Array.isArray(parsed.habits)) {
    parsed.tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    parsed.groups = Array.isArray(parsed.groups) ? parsed.groups : [];
    return parsed;
  }
  if (parsed.version === 1 && Array.isArray(parsed.tiles) && Array.isArray(parsed.sidebar)) {
    return {
      version: 2,
      tiles: parsed.tiles,
      habits: parsed.sidebar,   // the old sidebar rows ARE the habits (Story A)
      tasks: [],
      groups: [],
    };
  }
  return null;
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const migrated = migrateConfig(JSON.parse(raw));
      if (migrated) return migrated;
    }
  } catch (e) { /* fall through */ }
  return deepClone(DEFAULT_CONFIG);
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fall through */ }
  return fallback;
}

let config = loadConfig();
let state = loadJSON(STATE_KEY, {});
let ui = loadJSON(UI_KEY, { tab: 'breaks' });
let isEditing = false;
let isEditingTopics = false;

function saveConfig() { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); }
function saveState() { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
function saveUi() { localStorage.setItem(UI_KEY, JSON.stringify(ui)); }
function newId(prefix) { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ─────────────────────────── cloud layer ───────────────────────────

const cloud = {
  available: null,   // null = unknown, true, false
  reason: '',
  async req(key, options = {}) {
    try {
      const res = await fetch('/api/data/' + key, {
        method: options.method || 'GET',
        headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
        body: options.body,
      });
      if (res.status === 503) { this.setAvailable(false, 'not-configured'); return { ok: false, status: 503 }; }
      if (res.status === 401) { this.setAvailable(false, 'unauthorized'); return { ok: false, status: 401 }; }
      this.setAvailable(true, '');
      if (res.status === 404) return { ok: false, status: 404, missing: true };
      if (!res.ok) return { ok: false, status: res.status };
      if (options.method === 'PUT' || options.method === 'DELETE') return { ok: true };
      return { ok: true, data: await res.json() };
    } catch (e) {
      this.setAvailable(false, 'offline');
      return { ok: false, status: 0 };
    }
  },
  get(key) { return this.req(key); },
  put(key, obj) { return this.req(key, { method: 'PUT', body: JSON.stringify(obj) }); },
  del(key) { return this.req(key, { method: 'DELETE' }); },
  setAvailable(v, reason) {
    if (this.available === v && this.reason === reason) return;
    this.available = v;
    this.reason = reason;
    renderCloudStatus();
  },
};

function renderCloudStatus() {
  const el = document.getElementById('cloud-status');
  const banner = document.getElementById('banner');
  if (cloud.available === true) {
    el.innerHTML = '';
    el.append(dot(false), document.createTextNode('synced'));
    banner.textContent = '';
  } else if (cloud.available === false) {
    el.innerHTML = '';
    el.append(dot(true), document.createTextNode('local only'));
    if (cloud.reason === 'not-configured') {
      banner.textContent = 'Cloud storage isn’t set up yet — journal and topics stay on this device for now. See the Cloudflare Setup Runbook in the vault.';
    } else if (cloud.reason === 'unauthorized') {
      banner.textContent = 'Your session expired — reload this page to log in again.';
    } else {
      banner.textContent = 'Offline — changes are kept on this device and will sync when you’re back.';
    }
  }
  function dot(local) {
    const d = document.createElement('span');
    d.className = 'cloud-dot' + (local ? ' is-local' : '');
    return d;
  }
}

// ─────────────────────────── small helpers ───────────────────────────

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function arrowBtn(label, onClick) {
  const btn = el('button', 'arrow-btn', label);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}

function deleteBtn(onClick) {
  const btn = el('button', 'delete-btn', '🗑');
  btn.type = 'button';
  btn.title = 'Delete';
  btn.addEventListener('click', onClick);
  return btn;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prettyDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Toasts. showToast returns a handle so callers can cancel.
function showToast(message, { undoLabel, onUndo, duration = 5000 } = {}) {
  const host = document.getElementById('toast');
  const item = el('div', 'toast-item');
  item.append(el('span', null, message));
  let timer = null;
  const close = () => { clearTimeout(timer); item.remove(); };
  if (undoLabel) {
    const btn = el('button', null, undoLabel);
    btn.type = 'button';
    btn.addEventListener('click', () => { close(); onUndo && onUndo(); });
    item.append(btn);
  }
  host.append(item);
  return new Promise(resolve => {
    timer = setTimeout(() => { item.remove(); resolve(true); }, duration);
    if (undoLabel) {
      item.querySelector('button').addEventListener('click', () => resolve(false));
    }
  });
}

// ─────────────────────────── tabs ───────────────────────────

function switchTab(name) {
  ui.tab = name;
  saveUi();
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('is-active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === 'tab-' + name));
  if (name === 'news') refreshNews();
  if (name === 'journal') journal.open(journal.viewDate || todayStr());
}

// ─────────────────────────── Breaks tab ───────────────────────────

function renderBreaks() {
  document.getElementById('app').classList.toggle('is-edit-mode', isEditing);
  document.getElementById('edit-btn').textContent = isEditing ? 'Done editing' : 'Edit';
  renderHabits();
  renderTasks();
  renderGrid();
}

function makeStateCheckbox(id) {
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.dataset.id = id;
  cb.checked = !!state[id];
  cb.addEventListener('change', () => {
    if (cb.checked) state[id] = true; else delete state[id];
    saveState();
  });
  return cb;
}

function renderHabits() {
  const list = document.getElementById('habits');
  list.innerHTML = '';
  config.habits.forEach((row, idx) => list.appendChild(buildHabitRow(row, idx)));

  const addContainer = document.getElementById('add-habit-container');
  addContainer.innerHTML = '';
  if (isEditing) {
    const btn = el('button', 'add-row-btn', '+ Add habit');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      config.habits.push({ id: newId('s'), label: 'New habit', count: 1 });
      saveConfig();
      renderBreaks();
    });
    addContainer.appendChild(btn);
  }
}

function buildHabitRow(row, idx) {
  const li = el('li', 'activity' + (isEditing ? ' is-editing' : ''));
  li.dataset.id = row.id;

  if (!isEditing) {
    const main = el('div', 'activity-main');
    main.append(el('span', 'activity-label', row.label));
    const boxes = el('span', 'activity-boxes');
    for (let i = 1; i <= row.count; i++) boxes.appendChild(makeStateCheckbox(`${row.id}:${i}`));
    li.append(main, boxes);
  } else {
    const toolbar = el('div', 'row-controls');
    const up = arrowBtn('↑', () => { swap(config.habits, idx, idx - 1); saveConfig(); renderBreaks(); });
    up.disabled = idx === 0;
    const down = arrowBtn('↓', () => { swap(config.habits, idx, idx + 1); saveConfig(); renderBreaks(); });
    down.disabled = idx === config.habits.length - 1;
    const del = deleteBtn(() => {
      if (confirm(`Delete "${row.label}"?`)) {
        config.habits.splice(idx, 1);
        saveConfig();
        renderBreaks();
      }
    });
    toolbar.append(up, down, del);
    li.append(toolbar);

    const inputs = el('div', 'row-controls');
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.value = row.label;
    labelInput.addEventListener('change', () => {
      config.habits[idx].label = labelInput.value.trim() || 'Unnamed';
      saveConfig();
    });
    const countInput = document.createElement('input');
    countInput.type = 'number';
    countInput.min = '1';
    countInput.max = '9';
    countInput.value = row.count;
    countInput.title = 'Number of checkboxes';
    countInput.addEventListener('change', () => {
      const n = Math.max(1, Math.min(9, parseInt(countInput.value, 10) || 1));
      config.habits[idx].count = n;
      countInput.value = n;
      saveConfig();
    });
    inputs.append(labelInput, countInput);
    li.append(inputs);
  }
  return li;
}

function swap(arr, a, b) {
  if (b < 0 || b >= arr.length) return;
  const t = arr[a]; arr[a] = arr[b]; arr[b] = t;
}

// ── one-time tasks + dividers ──

const pendingDeletes = new Set();

function renderTasks() {
  const host = document.getElementById('tasks-container');
  host.innerHTML = '';

  const ungrouped = config.tasks.filter(t => !t.group);

  if (!isEditing) {
    const list = el('ul', 'task-list');
    ungrouped.forEach(t => list.appendChild(buildTaskRow(t)));
    host.append(list);

    config.groups.forEach(g => {
      const tasks = config.tasks.filter(t => t.group === g.id);
      const heading = el('div', 'group-heading', g.name);
      heading.style.borderLeftColor = g.color;
      heading.style.color = g.color;
      host.append(heading);
      const gl = el('ul', 'task-list');
      tasks.forEach(t => gl.appendChild(buildTaskRow(t)));
      if (!tasks.length) gl.append(el('li', 'empty-note', 'nothing here'));
      host.append(gl);
    });

    // quick add — adding a task should be as fast as ticking one off
    const qa = el('div', 'quick-add');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add a task…';
    const btn = el('button', null, 'Add');
    btn.type = 'button';
    const add = () => {
      const label = input.value.trim();
      if (!label) return;
      config.tasks.push({ id: newId('k'), label, group: null });
      saveConfig();
      input.value = '';
      renderTasks();
      host.querySelector('.quick-add input')?.focus();
    };
    btn.addEventListener('click', add);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    qa.append(input, btn);
    host.append(qa);
  } else {
    // edit mode: ungrouped tasks, then groups with their tasks, then add buttons
    const list = el('ul', 'task-list');
    ungrouped.forEach(t => list.appendChild(buildTaskEditRow(t)));
    host.append(list);

    config.groups.forEach((g, gIdx) => {
      host.append(buildGroupEditRow(g, gIdx));
      const gl = el('ul', 'task-list');
      config.tasks.filter(t => t.group === g.id).forEach(t => gl.appendChild(buildTaskEditRow(t)));
      host.append(gl);
    });

    const addTask = el('button', 'add-row-btn', '+ Add task');
    addTask.type = 'button';
    addTask.addEventListener('click', () => {
      config.tasks.push({ id: newId('k'), label: 'New task', group: null });
      saveConfig();
      renderTasks();
    });
    const addGroup = el('button', 'add-row-btn', '+ Add divider');
    addGroup.type = 'button';
    addGroup.style.marginTop = '6px';
    addGroup.addEventListener('click', () => {
      const used = new Set(config.groups.map(g => g.color));
      const color = GROUP_COLORS.find(c => !used.has(c)) || GROUP_COLORS[config.groups.length % GROUP_COLORS.length];
      config.groups.push({ id: newId('g'), name: 'New divider', color });
      saveConfig();
      renderTasks();
    });
    host.append(addTask, addGroup);
  }
}

function buildTaskRow(task) {
  const li = el('li', 'task-row' + (pendingDeletes.has(task.id) ? ' is-pending-delete' : ''));
  const main = el('div', 'activity-main');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = pendingDeletes.has(task.id);
  cb.addEventListener('change', async () => {
    if (!cb.checked) return;
    pendingDeletes.add(task.id);
    renderTasks();
    const expired = await showToast(`Done: ${task.label}`, { undoLabel: 'Undo' });
    if (expired && pendingDeletes.has(task.id)) {
      pendingDeletes.delete(task.id);
      config.tasks = config.tasks.filter(t => t.id !== task.id);
      saveConfig();
    } else {
      pendingDeletes.delete(task.id);
    }
    renderTasks();
  });
  main.append(cb, el('span', 'activity-label', task.label));
  li.append(main);
  return li;
}

function buildTaskEditRow(task) {
  const li = el('li', 'task-row is-editing');
  const idx = config.tasks.findIndex(t => t.id === task.id);

  const toolbar = el('div', 'row-controls');
  const siblings = config.tasks.map((t, i) => ({ t, i })).filter(x => (x.t.group || null) === (task.group || null));
  const pos = siblings.findIndex(x => x.t.id === task.id);
  const up = arrowBtn('↑', () => { swap(config.tasks, siblings[pos].i, siblings[pos - 1].i); saveConfig(); renderTasks(); });
  up.disabled = pos <= 0;
  const down = arrowBtn('↓', () => { swap(config.tasks, siblings[pos].i, siblings[pos + 1].i); saveConfig(); renderTasks(); });
  down.disabled = pos >= siblings.length - 1;
  const del = deleteBtn(() => {
    config.tasks.splice(idx, 1);
    saveConfig();
    renderTasks();
  });
  toolbar.append(up, down, del);
  li.append(toolbar);

  const inputs = el('div', 'row-controls');
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.value = task.label;
  labelInput.addEventListener('change', () => {
    config.tasks[idx].label = labelInput.value.trim() || 'Unnamed';
    saveConfig();
  });
  const groupSel = document.createElement('select');
  const optNone = el('option', null, '— no divider —');
  optNone.value = '';
  groupSel.append(optNone);
  config.groups.forEach(g => {
    const o = el('option', null, g.name);
    o.value = g.id;
    if (task.group === g.id) o.selected = true;
    groupSel.append(o);
  });
  groupSel.addEventListener('change', () => {
    config.tasks[idx].group = groupSel.value || null;
    saveConfig();
    renderTasks();
  });
  inputs.append(labelInput, groupSel);
  li.append(inputs);
  return li;
}

function buildGroupEditRow(group, gIdx) {
  const row = el('div', 'group-row is-editing');
  row.style.borderLeft = `3px solid ${group.color}`;

  const toolbar = el('div', 'row-controls');
  const up = arrowBtn('↑', () => { swap(config.groups, gIdx, gIdx - 1); saveConfig(); renderTasks(); });
  up.disabled = gIdx === 0;
  const down = arrowBtn('↓', () => { swap(config.groups, gIdx, gIdx + 1); saveConfig(); renderTasks(); });
  down.disabled = gIdx === config.groups.length - 1;
  const del = deleteBtn(() => {
    const orphans = config.tasks.filter(t => t.group === group.id).length;
    const msg = orphans
      ? `Delete divider "${group.name}"? Its ${orphans} task(s) move back to the general list.`
      : `Delete divider "${group.name}"?`;
    if (confirm(msg)) {
      config.tasks.forEach(t => { if (t.group === group.id) t.group = null; });
      config.groups.splice(gIdx, 1);
      saveConfig();
      renderTasks();
    }
  });
  toolbar.append(up, down, del);
  row.append(toolbar);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = group.name;
  nameInput.addEventListener('change', () => {
    config.groups[gIdx].name = nameInput.value.trim() || 'Unnamed';
    saveConfig();
  });
  row.append(nameInput);

  const swatches = el('div', 'color-swatches');
  GROUP_COLORS.forEach(c => {
    const s = el('button', 'swatch' + (group.color === c ? ' is-selected' : ''));
    s.type = 'button';
    s.style.background = c;
    s.title = c;
    s.addEventListener('click', () => {
      config.groups[gIdx].color = c;
      saveConfig();
      renderTasks();
    });
    swatches.append(s);
  });
  row.append(swatches);
  return row;
}

// ── playlist grid (unchanged behavior from Cycle 01) ──

function normalizeYouTubeUrl(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return '';
  let url;
  try { url = new URL(trimmed); } catch (e) { return null; }
  const host = url.hostname.toLowerCase();
  let videoId = '', listId = '';
  const isYouTube = ['youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'm.youtube.com'].includes(host);
  const isYoutuBe = host === 'youtu.be' || host === 'www.youtu.be';
  if (isYouTube) {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v') || '';
      listId = url.searchParams.get('list') || '';
    } else if (url.pathname === '/playlist') {
      listId = url.searchParams.get('list') || '';
    } else if (url.pathname.startsWith('/embed/')) {
      const after = url.pathname.slice('/embed/'.length);
      if (after === 'videoseries') listId = url.searchParams.get('list') || '';
      else { videoId = after; listId = url.searchParams.get('list') || ''; }
    } else return null;
  } else if (isYoutuBe) {
    videoId = url.pathname.slice(1);
    listId = url.searchParams.get('list') || '';
  } else return null;
  if (videoId && listId) return `https://www.youtube-nocookie.com/embed/${videoId}?list=${listId}`;
  if (videoId) return `https://www.youtube-nocookie.com/embed/${videoId}`;
  if (listId) return `https://www.youtube-nocookie.com/embed/videoseries?list=${listId}`;
  return null;
}

function playlistPageUrl(embedUrl) {
  if (!embedUrl) return null;
  let url;
  try { url = new URL(embedUrl); } catch (e) { return null; }
  const listId = url.searchParams.get('list');
  if (listId) return `https://www.youtube.com/playlist?list=${listId}`;
  const path = url.pathname;
  if (path.startsWith('/embed/')) {
    const videoId = path.slice('/embed/'.length);
    if (videoId && videoId !== 'videoseries') return `https://www.youtube.com/watch?v=${videoId}`;
  }
  return null;
}

function renderGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  config.tiles.forEach((tile, idx) => grid.appendChild(buildTile(tile, idx)));
  if (isEditing) {
    const addTile = el('button', 'add-tile-btn', '+ Add tile');
    addTile.type = 'button';
    addTile.style.gridColumn = '1 / -1';
    addTile.addEventListener('click', () => {
      config.tiles.push({ id: newId('t'), label: 'New tile', url: '' });
      saveConfig();
      renderBreaks();
    });
    grid.appendChild(addTile);
  }
}

function buildTile(tile, idx) {
  const div = el('div', 'tile' + (isEditing ? ' is-editing' : ''));
  div.dataset.id = tile.id;

  if (isEditing) {
    const toolbar = el('div', 'tile-edit-toolbar');
    const up = arrowBtn('↑', () => { swap(config.tiles, idx, idx - 1); saveConfig(); renderBreaks(); });
    up.disabled = idx === 0;
    const down = arrowBtn('↓', () => { swap(config.tiles, idx, idx + 1); saveConfig(); renderBreaks(); });
    down.disabled = idx === config.tiles.length - 1;
    const del = deleteBtn(() => {
      if (confirm(`Delete "${tile.label}"?`)) {
        config.tiles.splice(idx, 1);
        saveConfig();
        renderBreaks();
      }
    });
    toolbar.append(up, down, del);
    div.append(toolbar);
  }

  const header = el('header', 'tile-header');
  if (!isEditing) {
    const ytLink = playlistPageUrl(tile.url);
    let title;
    if (ytLink) {
      title = document.createElement('a');
      title.href = ytLink;
      title.target = '_blank';
      title.rel = 'noopener noreferrer';
      title.title = 'Open on YouTube';
    } else {
      title = document.createElement('span');
    }
    title.className = 'tile-title';
    title.textContent = tile.label;
    header.append(title, makeStateCheckbox(`${tile.id}:1`));
  } else {
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.value = tile.label;
    labelInput.addEventListener('change', () => {
      config.tiles[idx].label = labelInput.value.trim() || 'Unnamed';
      saveConfig();
    });
    header.append(labelInput);
  }
  div.append(header);

  if (isEditing) {
    const editBody = el('div', 'tile-edit-body');
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.placeholder = 'Paste a YouTube URL (or leave empty)';
    urlInput.value = tile.url;
    const errSpan = el('div', 'error-text');
    urlInput.addEventListener('change', () => {
      const v = urlInput.value.trim();
      if (!v) {
        config.tiles[idx].url = '';
        urlInput.classList.remove('is-invalid');
        errSpan.textContent = '';
        saveConfig();
        return;
      }
      const normalized = normalizeYouTubeUrl(v);
      if (normalized === null) {
        urlInput.classList.add('is-invalid');
        errSpan.textContent = "Couldn't parse that as a YouTube URL. Try a youtube.com/watch?v=… or playlist link.";
        return;
      }
      config.tiles[idx].url = normalized;
      urlInput.value = normalized;
      urlInput.classList.remove('is-invalid');
      errSpan.textContent = '';
      saveConfig();
    });
    editBody.append(urlInput, errSpan);
    div.append(editBody);
  } else {
    const frame = el('div', 'tile-frame' + (tile.url ? '' : ' tile-empty'));
    if (tile.url) {
      const iframe = document.createElement('iframe');
      iframe.src = tile.url;
      iframe.title = tile.label;
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.allow = 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      frame.append(iframe);
    } else {
      frame.append(el('span', null, '(no playlist set)'));
    }
    div.append(frame);
  }
  return div;
}

// ─────────────────────────── News & Shopping tab ───────────────────────────

let topicsDoc = null;   // {version, topics:[{id,label,note}]}
let digestDoc = null;   // written by the overnight agent
let newsStateDoc = null; // {dismissed:[id], pinned:[id]} — app-written, agent-reads dismissed

async function loadTopics() {
  const res = await cloud.get('topics');
  if (res.ok || res.missing) {
    topicsDoc = res.ok ? res.data : { version: 1, topics: [] };
    // one-time sync of any local-only topics created before cloud setup
    const local = loadJSON(TOPICS_LOCAL_KEY, null);
    if (local && Array.isArray(local.topics) && local.topics.length) {
      const have = new Set(topicsDoc.topics.map(t => t.label.toLowerCase()));
      let added = false;
      for (const t of local.topics) {
        if (!have.has(t.label.toLowerCase())) { topicsDoc.topics.push(t); added = true; }
      }
      if (added) {
        const saved = await cloud.put('topics', topicsDoc);
        if (saved.ok) localStorage.removeItem(TOPICS_LOCAL_KEY);
      }
    }
  } else {
    topicsDoc = loadJSON(TOPICS_LOCAL_KEY, { version: 1, topics: [] });
  }
}

async function saveTopics() {
  if (cloud.available === false) {
    localStorage.setItem(TOPICS_LOCAL_KEY, JSON.stringify(topicsDoc));
    return;
  }
  const res = await cloud.put('topics', topicsDoc);
  if (!res.ok) localStorage.setItem(TOPICS_LOCAL_KEY, JSON.stringify(topicsDoc));
}

async function loadNewsState() {
  const res = await cloud.get('news-state');
  if (res.ok || res.missing) {
    newsStateDoc = normalizeState(res.ok ? res.data : null);
    // union-merge any state saved locally before cloud was reachable
    const local = loadJSON(NEWS_STATE_LOCAL_KEY, null);
    if (local) {
      newsStateDoc = mergeState(newsStateDoc, local);
      const saved = await cloud.put('news-state', newsStateDoc);
      if (saved.ok) localStorage.removeItem(NEWS_STATE_LOCAL_KEY);
    }
  } else {
    newsStateDoc = normalizeState(loadJSON(NEWS_STATE_LOCAL_KEY, null));
  }
}

async function saveNewsState() {
  if (cloud.available === false) {
    localStorage.setItem(NEWS_STATE_LOCAL_KEY, JSON.stringify(newsStateDoc));
    return;
  }
  const res = await cloud.put('news-state', newsStateDoc);
  if (!res.ok) localStorage.setItem(NEWS_STATE_LOCAL_KEY, JSON.stringify(newsStateDoc));
}

// Apply a news-core state transform, persist, and re-render.
async function updateNewsState(next) {
  newsStateDoc = next;
  renderNews();          // immediate feedback; persistence follows
  await saveNewsState();
}

async function refreshNews() {
  if (!topicsDoc) await loadTopics();
  await loadNewsState();
  const res = await cloud.get('digest');
  digestDoc = res.ok ? res.data : null;
  renderNews();
}

function renderNews() {
  const host = document.getElementById('news-content');
  const gen = document.getElementById('news-generated');
  document.getElementById('news-edit-btn').textContent = isEditingTopics ? 'Done' : 'Edit topics';
  document.getElementById('news-edit-btn').classList.toggle('is-active', isEditingTopics);
  host.innerHTML = '';

  gen.textContent = digestDoc && digestDoc.generated
    ? 'updated ' + new Date(digestDoc.generated).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : '';

  if (isEditingTopics) {
    renderTopicEditor(host);
    return;
  }

  const topics = (topicsDoc && topicsDoc.topics) || [];
  if (!topics.length) {
    const p = el('p', 'empty-note', 'No topics yet. Click "Edit topics" and add something to keep tabs on — news, or an item you’re hunting for. The overnight agent picks new topics up automatically.');
    host.append(p);
    return;
  }

  const fresh = (digestDoc && digestDoc.fresh) || [];
  const problems = (digestDoc && digestDoc.problems) || [];
  const noNews = (digestDoc && digestDoc.noNews) || [];

  if (problems.length) {
    host.append(el('div', 'news-section-title', 'Needs attention'));
    problems.forEach(p => {
      const card = el('div', 'news-card is-problem');
      card.append(el('div', 'topic-name', p.topic));
      card.append(el('div', 'instruction', p.instruction));
      host.append(card);
    });
  }

  const { pinned, normal } = partitionItems(fresh, newsStateDoc);

  if (pinned.length) {
    host.append(el('div', 'news-section-title', 'Pinned'));
    pinned.forEach(item => host.append(newsCard(item, true)));
  }

  const freshTitle = el('div', 'news-section-title news-section-title-row');
  freshTitle.append(el('span', null, 'Fresh'));
  if (normal.length) {
    const dismissAll = el('button', 'dismiss-all-btn', 'Dismiss all');
    dismissAll.type = 'button';
    dismissAll.addEventListener('click', () => {
      if (!confirm('Dismiss all un-pinned items? Pinned items will stay.')) return;
      updateNewsState(dismissAllUnpinned(newsStateDoc, fresh));
    });
    freshTitle.append(dismissAll);
  }
  host.append(freshTitle);

  if (normal.length) {
    normal.forEach(item => host.append(newsCard(item, false)));
  } else {
    const msg = digestDoc
      ? (pinned.length ? 'Nothing else new — your pinned items are above.' : 'Nothing new since the last run.')
      : 'No digest yet — the overnight agent hasn’t run since this tab was set up.';
    host.append(el('p', 'empty-note', msg));
  }

  if (noNews.length) {
    host.append(el('div', 'news-section-title', 'No news (still tracking)'));
    const wrap = el('div', 'no-news-list');
    noNews.forEach(t => wrap.append(el('span', 'no-news-chip', typeof t === 'string' ? t : t.topic)));
    host.append(wrap);
  }

  // topics the digest hasn't mentioned yet (typically added today, or no digest yet)
  const mentioned = new Set([
    ...fresh.map(i => i.topicId), ...problems.map(i => i.topicId),
    ...noNews.map(i => (typeof i === 'string' ? null : i.topicId)).filter(Boolean),
  ]);
  const untracked = topics.filter(t => !mentioned.has(t.id));
  if (untracked.length) {
    host.append(el('div', 'news-section-title', 'Tracking starts tonight'));
    const wrap = el('div', 'no-news-list');
    untracked.forEach(t => wrap.append(el('span', 'no-news-chip', t.label)));
    host.append(wrap);
  }
}

// One news/shopping card with pin/unpin and (un-pinned only) dismiss controls.
function newsCard(item, isPinned) {
  const card = el('div', 'news-card' + (isPinned ? ' is-pinned' : ''));

  const head = el('div', 'news-card-head');
  head.append(el('div', 'topic-name', item.topic));

  const controls = el('div', 'news-card-controls');
  const pin = el('button', 'icon-btn' + (isPinned ? ' is-on' : ''), '📌');
  pin.type = 'button';
  pin.title = isPinned ? 'Unpin' : 'Pin';
  pin.setAttribute('aria-label', pin.title);
  pin.addEventListener('click', () => updateNewsState(togglePin(newsStateDoc, item.id)));
  controls.append(pin);

  // Story B: the × dismiss control exists only on un-pinned cards — a pinned
  // item must be unpinned before it can be dismissed.
  if (!isPinned) {
    const x = el('button', 'icon-btn', '×');
    x.type = 'button';
    x.title = 'Dismiss';
    x.setAttribute('aria-label', 'Dismiss');
    x.addEventListener('click', () => updateNewsState(dismiss(newsStateDoc, item.id)));
    controls.append(x);
  }
  head.append(controls);
  card.append(head);

  card.append(el('div', 'summary', item.summary));
  const meta = el('div', 'meta');
  if (item.url) {
    const a = document.createElement('a');
    a.href = item.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'Learn more →';
    meta.append(a);
  }
  if (item.source) meta.append(el('span', null, item.source));
  if (item.tier) meta.append(el('span', 'tier-pill', item.tier));
  card.append(meta);
  return card;
}

function renderTopicEditor(host) {
  const list = el('div', 'topic-edit-list');
  (topicsDoc.topics || []).forEach((t, idx) => {
    const row = el('div', 'topic-edit-row');
    const label = document.createElement('input');
    label.type = 'text';
    label.value = t.label;
    label.placeholder = 'Topic — e.g. "ergonomic split keyboard availability"';
    label.addEventListener('change', () => {
      topicsDoc.topics[idx].label = label.value.trim() || t.label;
      saveTopics();
    });
    const note = document.createElement('input');
    note.type = 'text';
    note.className = 'topic-note';
    note.value = t.note || '';
    note.placeholder = 'Note for the agent (optional) — size, budget, what counts as news…';
    note.addEventListener('change', () => {
      topicsDoc.topics[idx].note = note.value.trim();
      saveTopics();
    });
    const del = deleteBtn(() => {
      if (confirm(`Stop tracking "${t.label}"?`)) {
        topicsDoc.topics.splice(idx, 1);
        saveTopics();
        renderNews();
      }
    });
    row.append(label, note, del);
    list.append(row);
  });
  host.append(list);

  const add = el('button', 'add-row-btn', '+ Add topic');
  add.type = 'button';
  add.style.marginTop = '8px';
  add.addEventListener('click', () => {
    topicsDoc.topics.push({ id: newId('topic'), label: '', note: '', added: todayStr() });
    saveTopics();
    renderNews();
    const inputs = document.querySelectorAll('.topic-edit-row input[type="text"]');
    if (inputs.length >= 2) inputs[inputs.length - 2].focus();
  });
  host.append(add);

  const hint = el('p', 'empty-note',
    'Topics are free text — the agent decides how to track each one. Shopping topics follow the EU marketplace rules (Croatian local first, then Croatian online, then Amazon.de, then EU shops verified to ship to Croatia).');
  hint.style.marginTop = '10px';
  host.append(hint);
}

// ─────────────────────────── Journal tab ───────────────────────────

const journal = {
  doc: null,                 // {version, entries:{date:{text,mood,updated,hasPhoto}}}
  localOnly: false,
  viewDate: null,
  viewMode: 'day',           // 'day' | 'cal' | 'timeline'
  calMonth: null,            // 'YYYY-MM' shown in calendar
  searchQuery: '',
  saveTimer: null,
  tarotCache: {},
  photoCache: {},
  manifest: null,

  async load() {
    const res = await cloud.get('journal');
    if (res.ok || res.missing) {
      this.doc = res.ok ? res.data : { version: 1, entries: {} };
      this.localOnly = false;
      const local = loadJSON(JOURNAL_LOCAL_KEY, null);
      if (local && local.entries && Object.keys(local.entries).length) {
        let merged = false;
        for (const [date, entry] of Object.entries(local.entries)) {
          const existing = this.doc.entries[date];
          if (!existing || (entry.updated || 0) > (existing.updated || 0)) {
            this.doc.entries[date] = entry;
            merged = true;
          }
        }
        if (merged) {
          const saved = await cloud.put('journal', this.doc);
          if (saved.ok) localStorage.removeItem(JOURNAL_LOCAL_KEY);
          else this.localOnly = cloud.available === false;
        }
      }
    } else {
      this.doc = loadJSON(JOURNAL_LOCAL_KEY, { version: 1, entries: {} });
      this.localOnly = true;
    }
  },

  entry(date) {
    return this.doc.entries[date] || null;
  },

  setEntry(date, patch) {
    const cur = this.doc.entries[date] || { text: '', mood: null, updated: 0, hasPhoto: false };
    this.doc.entries[date] = { ...cur, ...patch, updated: Date.now() };
    this.scheduleSave();
  },

  scheduleSave() {
    setSaveState('saving…');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persist(), 2500);
  },

  async persist() {
    clearTimeout(this.saveTimer);
    if (!this.doc) return;
    // prune empty entries so the doc doesn't collect blank days
    for (const [date, e] of Object.entries(this.doc.entries)) {
      if (!e.text && !e.mood && !e.hasPhoto) delete this.doc.entries[date];
    }
    if (this.localOnly || cloud.available === false) {
      localStorage.setItem(JOURNAL_LOCAL_KEY, JSON.stringify(this.doc));
      setSaveState('saved on this device');
      return;
    }
    const res = await cloud.put('journal', this.doc);
    if (res.ok) {
      setSaveState('saved');
    } else {
      localStorage.setItem(JOURNAL_LOCAL_KEY, JSON.stringify(this.doc));
      setSaveState('saved on this device');
    }
  },

  async open(date) {
    if (!this.doc) await this.load();
    this.viewDate = date;
    this.viewMode = 'day';
    renderJournal();
    await this.ensureTarot(date);
    renderJournal();
  },

  async ensureTarot(date) {
    if (this.tarotCache[date] !== undefined) return;
    const res = await cloud.get('tarot-' + date);
    this.tarotCache[date] = res.ok ? res.data : null;
  },

  async quickDraw(date) {
    if (!this.manifest) {
      const res = await fetch('cards/manifest.json');
      this.manifest = await res.json();
    }
    const reading = drawReading(date, this.manifest);
    this.tarotCache[date] = reading;
    cloud.put('tarot-' + date, reading); // best effort — deterministic anyway
    renderJournal();
  },

  async ensurePhoto(date) {
    if (this.photoCache[date] !== undefined) return;
    const res = await cloud.get('photo-' + date);
    this.photoCache[date] = res.ok ? res.data : null;
    renderJournal();
  },

  async attachPhoto(date, file) {
    const dataUrl = await resizeImage(file, 1600, 0.82);
    this.photoCache[date] = dataUrl;
    this.setEntry(date, { hasPhoto: true });
    renderJournal();
    const res = await cloud.put('photo-' + date, dataUrl);
    if (!res.ok) showToast('Photo couldn’t reach cloud storage — it will be lost on reload.');
  },

  async removePhoto(date) {
    this.photoCache[date] = null;
    this.setEntry(date, { hasPhoto: false });
    cloud.del('photo-' + date);
    renderJournal();
  },

  onThisDay(date) {
    const [y, m, d] = date.split('-');
    const hits = [];
    for (const [other, e] of Object.entries(this.doc.entries)) {
      if (other === date || !e.text) continue;
      const [oy, om, od] = other.split('-');
      if (od === d && om === m && oy !== y) hits.push({ date: other, kind: `${y - oy} year${y - oy > 1 ? 's' : ''} ago` });
      else if (od === d && oy === y && om !== m) hits.push({ date: other, kind: monthsAgoLabel(m - om) });
    }
    hits.sort((a, b) => b.date.localeCompare(a.date));
    return hits.slice(0, 3);
    function monthsAgoLabel(n) {
      const k = ((n % 12) + 12) % 12 || 12;
      return `${k} month${k > 1 ? 's' : ''} ago`;
    }
  },
};

function setSaveState(text) {
  document.getElementById('save-state').textContent = text;
}

function resizeImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function promptForDate(date) {
  let h = 0;
  for (let i = 0; i < date.length; i++) h = (h * 31 + date.charCodeAt(i)) >>> 0;
  return PROMPTS[h % PROMPTS.length];
}

function renderJournal() {
  const date = journal.viewDate || todayStr();
  document.getElementById('journal-date').textContent = prettyDate(date);
  document.getElementById('cal-btn').classList.toggle('is-active', journal.viewMode === 'cal');
  document.getElementById('timeline-btn').classList.toggle('is-active', journal.viewMode === 'timeline');

  renderCalendar();
  renderTimeline();
  renderJournalDay(date);
}

function renderCalendar() {
  const host = document.getElementById('cal-container');
  host.innerHTML = '';
  if (journal.viewMode !== 'cal') return;

  const month = journal.calMonth || journal.viewDate.slice(0, 7);
  journal.calMonth = month;
  const [y, m] = month.split('-').map(Number);

  const grid = el('div', 'cal-grid');
  const head = el('div', 'cal-head');
  const prev = el('button', 'nav-btn', '‹');
  prev.type = 'button';
  prev.addEventListener('click', () => { journal.calMonth = shiftMonth(month, -1); renderJournal(); });
  const next = el('button', 'nav-btn', '›');
  next.type = 'button';
  next.addEventListener('click', () => { journal.calMonth = shiftMonth(month, 1); renderJournal(); });
  head.append(prev, el('span', 'cal-title', new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })), next);
  grid.append(head);

  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(d => grid.append(el('div', 'cal-dow', d)));

  const first = new Date(y, m - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = todayStr();

  for (let i = 0; i < startOffset; i++) grid.append(el('div'));
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cell = el('button', 'cal-day', String(d));
    cell.type = 'button';
    if (dateStr === today) cell.classList.add('is-today');
    if (dateStr === journal.viewDate) cell.classList.add('is-selected');
    const e = journal.entry(dateStr);
    if (e && (e.text || e.mood || e.hasPhoto)) cell.append(el('span', 'dot'));
    cell.addEventListener('click', () => {
      journal.viewDate = dateStr;
      journal.viewMode = 'day';
      journal.ensureTarot(dateStr).then(renderJournal);
      renderJournal();
    });
    grid.append(cell);
  }
  host.append(grid);

  function shiftMonth(ym, delta) {
    const [yy, mm] = ym.split('-').map(Number);
    const d = new Date(yy, mm - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}

function renderTimeline() {
  const host = document.getElementById('timeline-container');
  host.innerHTML = '';
  if (journal.viewMode !== 'timeline') return;

  const q = journal.searchQuery.trim().toLowerCase();
  const entries = Object.entries(journal.doc.entries)
    .filter(([, e]) => e.text || e.mood || e.hasPhoto)
    .filter(([, e]) => !q || (e.text || '').toLowerCase().includes(q))
    .sort((a, b) => b[0].localeCompare(a[0]));

  const wrap = el('div', 'timeline');
  if (!entries.length) {
    wrap.append(el('p', 'empty-note', q ? 'No entries match that search.' : 'No entries yet — today is a good day to start.'));
  }
  for (const [date, e] of entries) {
    const item = el('div', 'tl-entry');
    const head = el('div', 'tl-date');
    head.append(document.createTextNode(prettyDate(date)));
    if (e.mood) head.append(document.createTextNode(' ' + (MOODS.find(x => x.value === e.mood)?.emoji || '')));
    if (e.hasPhoto) head.append(document.createTextNode(' 📷'));
    item.append(head);
    if (e.text) item.append(el('div', 'tl-preview', e.text));
    item.addEventListener('click', () => {
      journal.viewDate = date;
      journal.viewMode = 'day';
      journal.ensureTarot(date).then(renderJournal);
      renderJournal();
    });
    wrap.append(item);
  }
  host.append(wrap);
}

function renderJournalDay(date) {
  const host = document.getElementById('journal-day');
  host.innerHTML = '';
  if (journal.viewMode !== 'day') return;

  // ── tarot block ──
  const reading = journal.tarotCache[date];
  if (reading) {
    host.append(buildTarotBlock(reading));
  } else if (journal.tarotCache[date] === null) {
    const block = el('div', 'tarot-block');
    const btn = el('button', 'tarot-draw-btn', '✦ Draw today’s cards');
    btn.type = 'button';
    btn.addEventListener('click', () => journal.quickDraw(date));
    block.append(btn);
    host.append(block);
  }

  // ── on this day ──
  const otd = journal.onThisDay(date);
  if (otd.length) {
    const box = el('div', 'otd-box');
    box.append(el('div', 'otd-title', 'On this day'));
    otd.forEach(hit => {
      const item = el('div', 'otd-item');
      const dateSpan = el('span', 'otd-date', hit.kind);
      const preview = (journal.entry(hit.date)?.text || '').slice(0, 110);
      item.append(dateSpan, document.createTextNode(' — ' + preview + (preview.length === 110 ? '…' : '')));
      item.addEventListener('click', () => {
        journal.viewDate = hit.date;
        journal.ensureTarot(hit.date).then(renderJournal);
        renderJournal();
      });
      box.append(item);
    });
    host.append(box);
  }

  const entry = journal.entry(date) || { text: '', mood: null, hasPhoto: false };

  // ── mood row ──
  const moodRow = el('div', 'mood-row');
  moodRow.append(el('span', 'mood-label', 'Mood'));
  MOODS.forEach(m => {
    const b = el('button', 'mood-btn' + (entry.mood === m.value ? ' is-selected' : ''), m.emoji);
    b.type = 'button';
    b.title = m.label;
    b.addEventListener('click', () => {
      const cur = journal.entry(date);
      journal.setEntry(date, { mood: cur && cur.mood === m.value ? null : m.value });
      renderJournal();
    });
    moodRow.append(b);
  });
  host.append(moodRow);

  // ── editor ──
  const ta = document.createElement('textarea');
  ta.id = 'journal-text';
  ta.value = entry.text || '';
  ta.placeholder = promptForDate(date);
  ta.addEventListener('input', () => journal.setEntry(date, { text: ta.value }));
  ta.addEventListener('blur', () => journal.persist());
  host.append(ta);

  // ── photo ──
  const photoArea = el('div', 'photo-area');
  if (entry.hasPhoto) {
    const cached = journal.photoCache[date];
    if (cached === undefined) {
      photoArea.append(el('span', 'empty-note', 'Loading photo…'));
      journal.ensurePhoto(date);
    } else if (cached) {
      const img = document.createElement('img');
      img.src = cached;
      img.alt = 'Journal photo';
      photoArea.append(img);
      const controls = el('div', 'photo-controls');
      const rm = el('button', 'io-btn', 'Remove photo');
      rm.type = 'button';
      rm.addEventListener('click', () => journal.removePhoto(date));
      controls.append(rm);
      photoArea.append(controls);
    } else {
      photoArea.append(el('span', 'empty-note', 'Photo unavailable (cloud storage unreachable).'));
    }
  } else {
    const controls = el('div', 'photo-controls');
    const add = el('button', 'io-btn', '📷 Add a photo');
    add.type = 'button';
    add.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', () => {
        if (input.files && input.files[0]) journal.attachPhoto(date, input.files[0]);
      });
      input.click();
    });
    controls.append(add);
    photoArea.append(controls);
  }
  host.append(photoArea);
}

function buildTarotBlock(reading) {
  const block = el('div', 'tarot-block');
  block.append(el('div', 'tarot-spread-name', reading.spread.name));

  const cards = el('div', 'tarot-cards');
  reading.cards.forEach(c => {
    const card = el('div', 'tarot-card');
    const frame = el('div', 'tarot-card-frame' + (c.reversed ? ' is-reversed' : ''));
    const img = document.createElement('img');
    img.src = 'cards/' + c.file;
    img.alt = c.name;
    frame.append(img);
    frame.append(el('div', 'tarot-card-name', c.name));
    card.append(frame);
    card.append(el('div', 'tarot-position', c.position));
    if (c.reversed) card.append(el('div', 'tarot-reversed-tag', 'reversed'));
    if (c.line) card.append(el('div', 'tarot-line', c.line));
    cards.append(card);
  });
  block.append(cards);

  if (reading.hook) block.append(el('div', 'tarot-hook', reading.hook));
  if (reading.body) block.append(el('div', 'tarot-body', reading.body));

  if ((reading.dos && reading.dos.length) || (reading.donts && reading.donts.length)) {
    const dd = el('div', 'tarot-dodont');
    if (reading.dos && reading.dos.length) {
      const d = el('div');
      d.append(el('div', 'dd-title', 'Do'));
      d.append(el('div', null, reading.dos.join(' · ')));
      dd.append(d);
    }
    if (reading.donts && reading.donts.length) {
      const d = el('div');
      d.append(el('div', 'dd-title', 'Don’t'));
      d.append(el('div', null, reading.donts.join(' · ')));
      dd.append(d);
    }
    block.append(dd);
  }

  if (reading.mantra) block.append(el('div', 'tarot-mantra', '“' + reading.mantra + '”'));
  block.append(el('div', 'tarot-source', reading.source === 'quick-draw' ? 'quick draw' : 'overnight reading'));
  return block;
}

function exportJournal() {
  const entries = Object.entries(journal.doc.entries)
    .filter(([, e]) => e.text || e.mood)
    .sort((a, b) => a[0].localeCompare(b[0]));
  let md = '# Journal export — ' + todayStr() + '\n';
  for (const [date, e] of entries) {
    md += `\n## ${date}`;
    if (e.mood) md += ' ' + (MOODS.find(x => x.value === e.mood)?.emoji || '');
    md += '\n\n' + (e.text || '') + '\n';
  }
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'journal-export.md';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─────────────────────────── config import/export ───────────────────────────

function exportConfig() {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mini-breaks-config.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importConfig() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const migrated = migrateConfig(JSON.parse(reader.result));
        if (!migrated) {
          alert("That file doesn't look like a Mini Breaks config (expected version 1 or 2).");
          return;
        }
        if (!confirm('Replace your current Mini Breaks layout with this file? Daily checkbox state is preserved.')) return;
        config = migrated;
        saveConfig();
        renderBreaks();
      } catch (e) {
        alert("Couldn't parse that file as JSON.");
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

// ─────────────────────────── init ───────────────────────────

document.getElementById('tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (btn) switchTab(btn.dataset.tab);
});

document.getElementById('edit-btn').addEventListener('click', () => { isEditing = !isEditing; renderBreaks(); });
document.getElementById('reset-btn').addEventListener('click', () => {
  state = {};
  localStorage.removeItem(STATE_KEY);
  renderBreaks();
});
document.getElementById('export-btn').addEventListener('click', exportConfig);
document.getElementById('import-btn').addEventListener('click', importConfig);

document.getElementById('news-edit-btn').addEventListener('click', () => {
  isEditingTopics = !isEditingTopics;
  renderNews();
});

document.getElementById('day-prev').addEventListener('click', () => {
  journal.viewDate = shiftDate(journal.viewDate || todayStr(), -1);
  journal.viewMode = 'day';
  journal.ensureTarot(journal.viewDate).then(renderJournal);
  renderJournal();
});
document.getElementById('day-next').addEventListener('click', () => {
  journal.viewDate = shiftDate(journal.viewDate || todayStr(), 1);
  journal.viewMode = 'day';
  journal.ensureTarot(journal.viewDate).then(renderJournal);
  renderJournal();
});
document.getElementById('today-btn').addEventListener('click', () => {
  journal.viewDate = todayStr();
  journal.viewMode = 'day';
  journal.ensureTarot(journal.viewDate).then(renderJournal);
  renderJournal();
});
document.getElementById('cal-btn').addEventListener('click', () => {
  journal.viewMode = journal.viewMode === 'cal' ? 'day' : 'cal';
  journal.calMonth = (journal.viewDate || todayStr()).slice(0, 7);
  renderJournal();
});
document.getElementById('timeline-btn').addEventListener('click', () => {
  journal.viewMode = journal.viewMode === 'timeline' ? 'day' : 'timeline';
  renderJournal();
});
document.getElementById('journal-search').addEventListener('input', e => {
  journal.searchQuery = e.target.value;
  if (journal.searchQuery.trim()) journal.viewMode = 'timeline';
  renderJournal();
});
document.getElementById('journal-export-btn').addEventListener('click', exportJournal);

window.addEventListener('beforeunload', () => { journal.persist(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') journal.persist();
});

saveConfig(); // persist (possibly migrated) config
renderBreaks();
renderCloudStatus();
switchTab(['breaks', 'news', 'journal'].includes(ui.tab) ? ui.tab : 'breaks');

})();
