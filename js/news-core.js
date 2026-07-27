// News inbox core — pure logic, no DOM. Drives the News & Shopping tab's
// sticky / pin / dismiss behavior (Cycle 03) and the node test suite.
//
// State document (`news-state` in KV): { dismissed: [id…], pinned: [id…] }.
// The app writes it; the overnight agent reads `dismissed` to prune. Item
// identity is hash-free so the LLM agent can reproduce the exact same id:
//   id = topicId + "::" + canonicalUrl(url)   (news)
//   id = topicId + "::" + <stable product key> (shopping without a URL)
//
// Invariant (Story B): an id is never both pinned and dismissed. A pinned
// item must be unpinned before it can be dismissed — enforced here, not just
// hidden in the UI.

// Canonicalize a URL so the same story resolves to one id regardless of
// tracking junk: lowercase host, drop #hash, strip utm_* and fbclid, drop a
// trailing slash. Mirrors the overnight agent's canonicalization (Runbook §4).
export function canonicalUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  let u;
  try {
    u = new URL(url);
  } catch {
    return url.trim().toLowerCase();
  }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  for (const k of [...u.searchParams.keys()]) {
    if (/^utm_/i.test(k) || k.toLowerCase() === 'fbclid') u.searchParams.delete(k);
  }
  let path = u.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const qs = u.searchParams.toString();
  return u.protocol + '//' + u.host + path + (qs ? '?' + qs : '');
}

// Resolve an item's stable id. Prefer the agent-assigned `id`; otherwise
// compute the identical rule as a fallback for legacy items.
export function itemId(item) {
  if (!item || typeof item !== 'object') return '';
  if (item.id) return item.id;
  const topic = item.topicId || '';
  const key = item.url ? canonicalUrl(item.url) : (item.productKey || '');
  return topic + '::' + key;
}

// Coerce any stored value into a well-formed state document.
// `acked` (Cycle 05) holds cleared "Needs attention" problem ids. It is a third,
// independent list — problem ids never mix with the item ids in dismissed/pinned.
export function normalizeState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    dismissed: Array.isArray(s.dismissed) ? s.dismissed.slice() : [],
    pinned: Array.isArray(s.pinned) ? s.pinned.slice() : [],
    acked: Array.isArray(s.acked) ? s.acked.slice() : [],
  };
}

// Split displayable items into pinned-first and normal lists, dropping
// dismissed items. Each returned item carries its resolved `id`. Input order
// is preserved within each group.
export function partitionItems(items, state) {
  const st = normalizeState(state);
  const dismissed = new Set(st.dismissed);
  const pinned = new Set(st.pinned);
  const pinnedItems = [];
  const normalItems = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const id = itemId(raw);
    if (dismissed.has(id)) continue;
    const item = { ...raw, id };
    if (pinned.has(id)) pinnedItems.push(item);
    else normalItems.push(item);
  }
  return { pinned: pinnedItems, normal: normalItems };
}

// Pin or unpin an id. Returns a new state. (Dismissed ids can't be displayed,
// so a dismissed id is never pinned in practice; we still keep the invariant by
// never adding a dismissed id to pinned.)
export function togglePin(state, id) {
  const st = normalizeState(state);
  const pinned = new Set(st.pinned);
  if (pinned.has(id)) {
    pinned.delete(id);
  } else if (!st.dismissed.includes(id)) {
    pinned.add(id);
  }
  return { dismissed: st.dismissed.slice(), pinned: [...pinned], acked: st.acked.slice() };
}

// Dismiss an id — UNLESS it is currently pinned, in which case this is a no-op
// (Story B: unpin before dismiss). Returns a new state.
export function dismiss(state, id) {
  const st = normalizeState(state);
  if (st.pinned.includes(id)) return st;
  const dismissed = new Set(st.dismissed);
  dismissed.add(id);
  return { dismissed: [...dismissed], pinned: st.pinned.slice(), acked: st.acked.slice() };
}

// Dismiss every displayed item that isn't pinned; pinned items survive.
export function dismissAllUnpinned(state, items) {
  const st = normalizeState(state);
  const pinned = new Set(st.pinned);
  const dismissed = new Set(st.dismissed);
  for (const raw of Array.isArray(items) ? items : []) {
    const id = itemId(raw);
    if (!pinned.has(id)) dismissed.add(id);
  }
  return { dismissed: [...dismissed], pinned: st.pinned.slice(), acked: st.acked.slice() };
}

// ── "Needs attention" problems (Cycle 05) ───────────────────────────────────
//
// A problem's identity is keyed on its KIND, not on its instruction text: the
// agent rewrites that text every night (it carries a "re-confirmed <date>"
// stamp), so a text hash would resurrect every cleared card nightly. Keying on
// kind also means an ESCALATION — the agent switching a topic from a degraded
// warning to "drop this topic" (kind `fail-streak`) — produces a NEW id, so a
// worsening problem still reaches Heidi past an earlier clear.

export function problemId(problem) {
  if (!problem || typeof problem !== 'object') return '';
  if (problem.id) return problem.id;
  return (problem.topicId || '') + '!!' + (problem.kind || 'other');
}

// Clearing is permanent for that problem: the nightly regeneration cannot bring
// a cleared card back. Heidi's complaint was that these cards never clear, and a
// card that returns on its own is a card that didn't clear.
export function ackProblem(state, id) {
  const st = normalizeState(state);
  const acked = new Set(st.acked);
  acked.add(id);
  return { dismissed: st.dismissed.slice(), pinned: st.pinned.slice(), acked: [...acked] };
}

export function unackProblem(state, id) {
  const st = normalizeState(state);
  const acked = new Set(st.acked);
  acked.delete(id);
  return { dismissed: st.dismissed.slice(), pinned: st.pinned.slice(), acked: [...acked] };
}

// Split problems into the ones still showing and the ones Heidi has cleared.
// Each returned entry carries its resolved `id`; input order is preserved.
export function partitionProblems(problems, state) {
  const st = normalizeState(state);
  const acked = new Set(st.acked);
  const visible = [];
  const cleared = [];
  for (const raw of Array.isArray(problems) ? problems : []) {
    const id = problemId(raw);
    const entry = { ...raw, id };
    if (acked.has(id)) cleared.push(entry);
    else visible.push(entry);
  }
  return { visible, cleared };
}

// Union-merge two states (local fallback ↔ cloud), preserving the invariant:
// dismissal is terminal, so an id dismissed in either source is never pinned.
export function mergeState(a, b) {
  const sa = normalizeState(a);
  const sb = normalizeState(b);
  const dismissed = new Set([...sa.dismissed, ...sb.dismissed]);
  const pinned = new Set([...sa.pinned, ...sb.pinned]);
  const acked = new Set([...sa.acked, ...sb.acked]);
  for (const id of dismissed) pinned.delete(id);
  return { dismissed: [...dismissed], pinned: [...pinned], acked: [...acked] };
}
