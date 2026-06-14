import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setTaskGroup, groupOptions } from '../js/tasks-core.js';

// A fresh config fixture each call — tests mutate it in place (mirrors the app's
// live `config` object).
function fixture() {
  return {
    groups: [
      { id: 'g-stuck', name: 'Stuck', color: '#2a9d8f' },
      { id: 'g-deck', name: 'On deck', color: '#5a8fc4' },
    ],
    tasks: [
      { id: 'k-1', label: 'general task', group: null },
      { id: 'k-2', label: 'stuck task', group: 'g-stuck' },
    ],
  };
}

test('setTaskGroup assigns an ungrouped task to an existing divider', () => {
  const c = fixture();
  const changed = setTaskGroup(c, 'k-1', 'g-stuck');
  assert.equal(changed, true);
  assert.equal(c.tasks.find(t => t.id === 'k-1').group, 'g-stuck');
});

test('setTaskGroup moves a task from one divider to another (Stuck → On deck)', () => {
  const c = fixture();
  const changed = setTaskGroup(c, 'k-2', 'g-deck');
  assert.equal(changed, true);
  assert.equal(c.tasks.find(t => t.id === 'k-2').group, 'g-deck');
});

test('setTaskGroup clears a task back to no divider', () => {
  const c = fixture();
  const changed = setTaskGroup(c, 'k-2', null);
  assert.equal(changed, true);
  assert.equal(c.tasks.find(t => t.id === 'k-2').group, null);
});

test('setTaskGroup coerces an unknown/stale divider id to null', () => {
  const c = fixture();
  const changed = setTaskGroup(c, 'k-1', 'g-deleted');
  assert.equal(changed, false, 'k-1 was already null, so no change');
  assert.equal(c.tasks.find(t => t.id === 'k-1').group, null);
  // a grouped task pointed at a stale id falls back to null (and that IS a change)
  const changed2 = setTaskGroup(c, 'k-2', 'g-deleted');
  assert.equal(changed2, true);
  assert.equal(c.tasks.find(t => t.id === 'k-2').group, null);
});

test('setTaskGroup coerces an empty string to null', () => {
  const c = fixture();
  const changed = setTaskGroup(c, 'k-2', '');
  assert.equal(changed, true);
  assert.equal(c.tasks.find(t => t.id === 'k-2').group, null);
});

test('setTaskGroup is a no-op (returns false) when the group is unchanged', () => {
  const c = fixture();
  assert.equal(setTaskGroup(c, 'k-2', 'g-stuck'), false);
  assert.equal(setTaskGroup(c, 'k-1', null), false);
});

test('setTaskGroup is a safe no-op for an unknown task id', () => {
  const c = fixture();
  assert.equal(setTaskGroup(c, 'k-nope', 'g-stuck'), false);
});

test('groupOptions leads with a no-divider entry', () => {
  const c = fixture();
  const opts = groupOptions(c, c.tasks[0]);
  assert.equal(opts[0].id, null);
  assert.equal(opts[0].name, 'no divider');
});

test('groupOptions reflects the current dividers in order', () => {
  const c = fixture();
  const opts = groupOptions(c, c.tasks[0]);
  assert.deepEqual(opts.map(o => o.id), [null, 'g-stuck', 'g-deck']);
  assert.deepEqual(opts.map(o => o.name), ['no divider', 'Stuck', 'On deck']);
});

test('groupOptions marks the current selection', () => {
  const c = fixture();
  const unsetOpts = groupOptions(c, c.tasks[0]); // group: null
  assert.equal(unsetOpts.find(o => o.selected).id, null);
  const stuckOpts = groupOptions(c, c.tasks[1]); // group: g-stuck
  assert.equal(stuckOpts.find(o => o.selected).id, 'g-stuck');
});

test('groupOptions with no dividers returns only the no-divider entry (control hides)', () => {
  const c = { groups: [], tasks: [{ id: 'k-1', label: 'x', group: null }] };
  const opts = groupOptions(c, c.tasks[0]);
  assert.equal(opts.length, 1);
  assert.equal(opts[0].id, null);
});
