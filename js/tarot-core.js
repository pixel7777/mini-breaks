// Tarot core — pure logic, no DOM. Used by the app's quick-draw fallback
// (when the overnight reading is absent) and by the node test suite.

export const SPREADS = [
  { name: 'Past · Present · Future', positions: ['Past', 'Present', 'Future'] },
  { name: 'Situation · Obstacle · Advice', positions: ['Situation', 'Obstacle', 'Advice'] },
  { name: 'Mind · Body · Spirit', positions: ['Mind', 'Body', 'Spirit'] },
  { name: 'Situation · Action · Outcome', positions: ['Situation', 'Action', 'Outcome'] },
  { name: 'Stop · Start · Continue', positions: ['Stop', 'Start', 'Continue'] },
  { name: 'Yesterday · Today · Tomorrow', positions: ['Yesterday', 'Today', 'Tomorrow'] },
];

export const QUICK_MANTRAS = [
  'Small steps still count as walking.',
  'You are allowed to take the easy road today.',
  'Done is a kind of beautiful.',
  'Drink the water. Stretch the back. Trust the process.',
  'Today is a rough draft — write it anyway.',
  'The cards suggest snacks. The cards are wise.',
  'Be the calm teal of your own dashboard.',
  'One thing at a time is a perfectly good pace.',
  'Let the to-do list fear you for a change.',
  'Rest is productive. The Hermit said so.',
  'Your future self is already proud of you.',
  'Stir the pot gently; it is your pot.',
  'Today, choose curiosity over hurry.',
  'The Wheel turns whether you refresh or not.',
  'Carry less. Notice more.',
  'You can always reshuffle tomorrow.',
  'Strength looks suspiciously like taking a break.',
  'Plant one seed and call it a garden.',
  'Speak kindly to the project that is fighting you.',
  'The draw is light; let the day be light too.',
];

// Deterministic PRNG so a given date always quick-draws the same reading.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashDate(dateStr) {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function spreadForDate(dateStr) {
  // Rotate through the spreads by day so variety is guaranteed, not lucky.
  const d = new Date(dateStr + 'T12:00:00');
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  return SPREADS[dayOfYear % SPREADS.length];
}

// Draw a complete quick-reading for a date from the deck manifest.
// Reversals appear ~1 in 4 — present enough to be fun, rare enough to stay light.
export function drawReading(dateStr, manifest) {
  const rand = mulberry32(hashDate(dateStr));
  const spread = spreadForDate(dateStr);
  const deck = manifest.cards.slice();
  const cards = [];
  for (let i = 0; i < 3; i++) {
    const idx = Math.floor(rand() * deck.length);
    const card = deck.splice(idx, 1)[0];
    const reversed = rand() < 0.25;
    cards.push({
      id: card.id,
      name: card.name,
      file: card.file,
      reversed,
      position: spread.positions[i],
      line: reversed ? card.reversed : card.upright,
    });
  }
  const mantra = QUICK_MANTRAS[Math.floor(rand() * QUICK_MANTRAS.length)];
  return {
    date: dateStr,
    spread: { name: spread.name, positions: spread.positions },
    cards,
    hook: null,
    body: null,
    dos: [],
    donts: [],
    mantra,
    source: 'quick-draw',
  };
}
