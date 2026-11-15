import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalAsset, mergeSets } from '../scripts/symbols/sync-tcgdex-symbols.mjs';

test('symbol and logo URLs use the set asset pattern', () => {
  assert.equal(canonicalAsset('https://assets.tcgdex.net/univ/swsh/swsh3/symbol'),
    'https://assets.tcgdex.net/univ/swsh/swsh3/symbol.png');
  assert.equal(canonicalAsset('https://evil.example/symbol'), null);
  assert.equal(canonicalAsset('http://assets.tcgdex.net/univ/symbol'), null);
});
test('sets merge by stable provider ID, not language-specific name', () => {
  const sets = mergeSets({
    en: [{ id: 'swsh3', name: 'Darkness Ablaze', symbol: 'https://assets.tcgdex.net/univ/swsh/swsh3/symbol', cardCount: { total: 201 } }],
    it: [{ id: 'swsh3', name: 'Fiamme Oscure', symbol: 'https://assets.tcgdex.net/univ/swsh/swsh3/symbol' }]
  });
  assert.equal(sets.length, 1);
  assert.equal(sets[0].names.it, 'Fiamme Oscure');
  assert.equal(Object.keys(sets[0].symbols).length, 2);
});
