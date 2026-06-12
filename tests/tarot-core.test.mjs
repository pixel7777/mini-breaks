import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { drawReading, spreadForDate, SPREADS } from '../js/tarot-core.js';

const manifest = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'cards', 'manifest.json'), 'utf8')
);

test('the deck manifest has all 78 cards with meanings and existing fields', () => {
  assert.equal(manifest.cards.length, 78);
  for (const c of manifest.cards) {
    assert.ok(c.id && c.name && c.file && c.upright && c.reversed, c.id || c.name);
  }
});

test('a quick-draw produces three distinct cards with position labels and lines', () => {
  const r = drawReading('2026-06-12', manifest);
  assert.equal(r.cards.length, 3);
  assert.equal(new Set(r.cards.map(c => c.id)).size, 3);
  for (const c of r.cards) {
    assert.ok(c.position, 'position label');
    assert.ok(c.line, 'meaning line');
  }
  assert.ok(r.mantra);
  assert.equal(r.source, 'quick-draw');
});

test('the same date always draws the same reading (deterministic)', () => {
  const a = drawReading('2026-06-12', manifest);
  const b = drawReading('2026-06-12', manifest);
  assert.deepEqual(a, b);
});

test('different dates draw different readings (no stuck seed)', () => {
  const a = drawReading('2026-06-12', manifest);
  const b = drawReading('2026-06-13', manifest);
  assert.notDeepEqual(a.cards.map(c => c.id), b.cards.map(c => c.id));
});

test('a reversed card uses the reversed meaning', () => {
  // Sweep dates until a reversal shows up; ~1 in 4 per card means this finds one fast.
  for (let day = 1; day <= 28; day++) {
    const r = drawReading(`2026-07-${String(day).padStart(2, '0')}`, manifest);
    const rev = r.cards.find(c => c.reversed);
    if (rev) {
      const source = manifest.cards.find(c => c.id === rev.id);
      assert.equal(rev.line, source.reversed);
      return;
    }
  }
  assert.fail('no reversal in 28 consecutive days — reversal rate is broken');
});

test('the spread rotates day to day through all six', () => {
  const seen = new Set();
  for (let day = 1; day <= 6; day++) {
    seen.add(spreadForDate(`2026-08-0${day}`).name);
  }
  assert.equal(seen.size, SPREADS.length);
});
