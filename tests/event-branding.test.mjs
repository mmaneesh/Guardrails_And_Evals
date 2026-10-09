import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const deck = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('keeps Ministry of Testing as the default event', () => {
  assert.match(deck, /default:\s*\{[\s\S]*?MINISTRY OF TESTING/);
});

test('defines the Test Tribe Chicago event details', () => {
  assert.match(deck, /'test-tribe-chicago':\s*\{[\s\S]*?THE TEST TRIBE[\s\S]*?CHICAGO CHAPTER[\s\S]*?27 OCTOBER 2026/);
});

test('uses the event query parameter to update both deck footers', () => {
  assert.match(deck, /new URLSearchParams\(window\.location\.search\)\.get\('event'\)/);
  assert.equal((deck.match(/<div class="mn-meta" data-event-meta/g) || []).length, 2);
});
