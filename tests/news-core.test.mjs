import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalUrl, itemId, normalizeState, partitionItems,
  togglePin, dismiss, dismissAllUnpinned, mergeState,
  problemId, ackProblem, unackProblem, partitionProblems,
} from '../js/news-core.js';

// ── canonicalUrl ──

test('canonicalUrl lowercases host, drops hash, strips utm_*/fbclid, drops trailing slash', () => {
  assert.equal(
    canonicalUrl('https://Example.COM/path/?utm_source=x&utm_medium=y&keep=1&fbclid=abc#frag'),
    'https://example.com/path?keep=1'
  );
  assert.equal(canonicalUrl('https://example.com/a/'), 'https://example.com/a');
  assert.equal(canonicalUrl('https://example.com/'), 'https://example.com/'); // root slash kept
});

test('canonicalUrl is stable: canonicalizing an already-canonical url is a no-op', () => {
  const once = canonicalUrl('https://Shop.hr/item/123/?utm_campaign=z#reviews');
  assert.equal(canonicalUrl(once), once);
});

test('canonicalUrl tolerates junk input', () => {
  assert.equal(canonicalUrl(''), '');
  assert.equal(canonicalUrl(null), '');
  assert.equal(canonicalUrl('not a url'), 'not a url');
});

// ── itemId ──

test('itemId prefers an agent-assigned id', () => {
  assert.equal(itemId({ id: 'topic1::https://x.com/a', topicId: 'topic1', url: 'https://other' }), 'topic1::https://x.com/a');
});

test('itemId falls back to topicId + canonicalUrl, identical to the agent rule', () => {
  assert.equal(
    itemId({ topicId: 'kbd', url: 'https://Shop.hr/x/?utm_source=q' }),
    'kbd::https://shop.hr/x'
  );
});

test('itemId is stable across tracking-param variants of the same url', () => {
  const a = itemId({ topicId: 't', url: 'https://n.hr/story?utm_source=a' });
  const b = itemId({ topicId: 't', url: 'https://n.hr/story?utm_source=b#x' });
  assert.equal(a, b);
});

test('itemId for a urlless shopping item uses a stable product key', () => {
  assert.equal(itemId({ topicId: 'shoes', productKey: 'sku-42' }), 'shoes::sku-42');
});

// ── normalizeState ──

test('normalizeState coerces junk into a well-formed doc', () => {
  assert.deepEqual(normalizeState(null), { dismissed: [], pinned: [], acked: [] });
  assert.deepEqual(normalizeState({ dismissed: ['a'] }), { dismissed: ['a'], pinned: [], acked: [] });
  assert.deepEqual(normalizeState({ pinned: ['b'], junk: 1 }), { dismissed: [], pinned: ['b'], acked: [] });
});

test('a pre-Cycle-05 state document loads with an empty acked list', () => {
  assert.deepEqual(normalizeState({ dismissed: ['a'], pinned: ['b'] }).acked, []);
  assert.deepEqual(normalizeState({ acked: 'not-an-array' }).acked, []);
});

// ── partitionItems ──

const items = [
  { topicId: 't', url: 'https://a.com/1' },
  { topicId: 't', url: 'https://a.com/2' },
  { topicId: 't', url: 'https://a.com/3' },
];

test('partitionItems drops dismissed and puts pinned in their own list, pinned-first', () => {
  const state = { dismissed: ['t::https://a.com/2'], pinned: ['t::https://a.com/3'] };
  const { pinned, normal } = partitionItems(items, state);
  assert.deepEqual(pinned.map(i => i.id), ['t::https://a.com/3']);
  assert.deepEqual(normal.map(i => i.id), ['t::https://a.com/1']);
});

test('partitionItems stamps every returned item with its resolved id', () => {
  const { normal } = partitionItems(items, {});
  assert.ok(normal.every(i => typeof i.id === 'string' && i.id.length));
});

test('partitionItems preserves input order within each group', () => {
  const state = { pinned: ['t::https://a.com/1', 't::https://a.com/3'] };
  const { pinned } = partitionItems(items, state);
  assert.deepEqual(pinned.map(i => i.id), ['t::https://a.com/1', 't::https://a.com/3']);
});

// ── togglePin ──

test('togglePin adds then removes an id, returning new state each time', () => {
  const s0 = normalizeState(null);
  const s1 = togglePin(s0, 'x');
  assert.deepEqual(s1.pinned, ['x']);
  const s2 = togglePin(s1, 'x');
  assert.deepEqual(s2.pinned, []);
  assert.deepEqual(s0.pinned, []); // original untouched
});

test('togglePin never pins a dismissed id', () => {
  const s = togglePin({ dismissed: ['x'], pinned: [] }, 'x');
  assert.deepEqual(s.pinned, []);
});

// ── dismiss (the Story B rule) ──

test('dismiss on an un-pinned id adds it to dismissed', () => {
  const s = dismiss({ dismissed: [], pinned: [] }, 'x');
  assert.deepEqual(s.dismissed, ['x']);
});

test('dismiss on a PINNED id is a no-op (must unpin first — Story B)', () => {
  const before = { dismissed: [], pinned: ['x'] };
  const after = dismiss(before, 'x');
  assert.deepEqual(after.dismissed, []);
  assert.deepEqual(after.pinned, ['x']);
});

test('an id is never simultaneously pinned and dismissed', () => {
  let s = normalizeState(null);
  s = togglePin(s, 'x');     // pin
  s = dismiss(s, 'x');       // refused
  assert.ok(!(s.pinned.includes('x') && s.dismissed.includes('x')));
  s = togglePin(s, 'x');     // unpin
  s = dismiss(s, 'x');       // now allowed
  assert.deepEqual(s.dismissed, ['x']);
  assert.deepEqual(s.pinned, []);
});

// ── dismissAllUnpinned ──

test('dismissAllUnpinned clears un-pinned items and leaves pinned standing', () => {
  const state = { dismissed: [], pinned: ['t::https://a.com/2'] };
  const after = dismissAllUnpinned(state, items);
  assert.deepEqual(after.pinned, ['t::https://a.com/2']);
  assert.deepEqual(
    after.dismissed.sort(),
    ['t::https://a.com/1', 't::https://a.com/3'].sort()
  );
});

// ── mergeState (local ↔ cloud union) ──

test('mergeState unions both lists', () => {
  const m = mergeState({ dismissed: ['a'], pinned: ['p'] }, { dismissed: ['b'], pinned: ['q'] });
  assert.deepEqual(m.dismissed.sort(), ['a', 'b']);
  assert.deepEqual(m.pinned.sort(), ['p', 'q']);
});

test('mergeState keeps dismissal terminal: an id dismissed anywhere is not pinned', () => {
  const m = mergeState({ dismissed: ['x'], pinned: [] }, { dismissed: [], pinned: ['x'] });
  assert.deepEqual(m.dismissed, ['x']);
  assert.deepEqual(m.pinned, []);
});

test('mergeState unions acked as well, so a clear made offline is not lost', () => {
  const m = mergeState({ acked: ['t1!!tooling'] }, { acked: ['t2!!no-source'] });
  assert.deepEqual(m.acked.sort(), ['t1!!tooling', 't2!!no-source']);
});

// ── problems: clearing "Needs attention" (Cycle 05) ──

const PROBLEMS = [
  { topicId: 'topic-a', kind: 'js-storefront', topic: 'Lume', instruction: 'open the page' },
  { topicId: 'system-tooling', kind: 'tooling', topic: 'Overnight task tooling', instruction: 'fix the fetch path' },
];

test('problemId is keyed on kind, so nightly instruction rewrites do not change it', () => {
  const monday = { topicId: 'topic-a', kind: 'js-storefront', instruction: 'night 40 of the identical result' };
  const tuesday = { topicId: 'topic-a', kind: 'js-storefront', instruction: 'night 41 of the identical result' };
  assert.equal(problemId(monday), problemId(tuesday));
  assert.equal(problemId(monday), 'topic-a!!js-storefront');
});

test('an escalation changes the kind, so a worsening problem gets a NEW id', () => {
  const mild = { topicId: 'topic-a', kind: 'js-storefront' };
  const escalated = { topicId: 'topic-a', kind: 'fail-streak' };
  assert.notEqual(problemId(mild), problemId(escalated));
});

test('an agent-supplied id wins, and a kindless problem still gets a stable id', () => {
  assert.equal(problemId({ id: 'explicit', topicId: 'x', kind: 'y' }), 'explicit');
  assert.equal(problemId({ topicId: 'x' }), 'x!!other');
  assert.equal(problemId(null), '');
});

test('clearing a card removes it from view and puts it in cleared', () => {
  const st = ackProblem(normalizeState(null), 'topic-a!!js-storefront');
  const { visible, cleared } = partitionProblems(PROBLEMS, st);
  assert.deepEqual(visible.map(p => p.id), ['system-tooling!!tooling']);
  assert.deepEqual(cleared.map(p => p.id), ['topic-a!!js-storefront']);
});

test('a cleared card stays cleared when the agent regenerates the same problem', () => {
  const st = ackProblem(normalizeState(null), 'topic-a!!js-storefront');
  // the next night's digest: same problem, freshly reworded
  const tonight = [{ topicId: 'topic-a', kind: 'js-storefront', instruction: 're-confirmed 2026-07-28' }];
  const { visible } = partitionProblems(tonight, st);
  assert.deepEqual(visible, []);
});

test('restoring a cleared card brings it back into view', () => {
  let st = ackProblem(normalizeState(null), 'topic-a!!js-storefront');
  st = unackProblem(st, 'topic-a!!js-storefront');
  const { visible, cleared } = partitionProblems(PROBLEMS, st);
  assert.equal(visible.length, 2);
  assert.equal(cleared.length, 0);
});

test('ack/unack are pure and leave dismissed and pinned untouched', () => {
  const base = { dismissed: ['d'], pinned: ['p'], acked: [] };
  const after = ackProblem(base, 'x!!tooling');
  assert.deepEqual(base.acked, []);            // original untouched
  assert.deepEqual(after.dismissed, ['d']);
  assert.deepEqual(after.pinned, ['p']);
  assert.deepEqual(after.acked, ['x!!tooling']);
});

test('acking the same id twice does not duplicate it', () => {
  let st = ackProblem(normalizeState(null), 'x!!tooling');
  st = ackProblem(st, 'x!!tooling');
  assert.deepEqual(st.acked, ['x!!tooling']);
});

test('partitionProblems tolerates a missing or non-array problems list', () => {
  assert.deepEqual(partitionProblems(null, normalizeState(null)), { visible: [], cleared: [] });
  assert.deepEqual(partitionProblems(undefined, null), { visible: [], cleared: [] });
});

test('clearing a problem does not affect fresh-item dismissal, and vice versa', () => {
  const items = [{ topicId: 't', url: 'https://a.com/1' }];
  let st = ackProblem(normalizeState(null), 't!!tooling');
  const { normal } = partitionItems(items, st);
  assert.equal(normal.length, 1, 'an acked problem id must not hide a news item');

  st = dismiss(st, 't::https://a.com/1');
  const { visible } = partitionProblems([{ topicId: 't', kind: 'tooling' }], st);
  assert.equal(visible.length, 0, 'the problem stays cleared through an unrelated dismissal');
});
