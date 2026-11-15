#!/usr/bin/env node
/**
 * Incremental symbol/expansion logo registry. Read-only TCGdex ingestion.
 * Run: node scripts/symbols/sync-tcgdex-symbols.mjs
 * Optional: SYMBOL_LANGUAGES=en,it,ja SYMBOL_OUTPUT=data/symbols/tcgdex.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_LANGS = ['en', 'it', 'fr', 'de', 'es', 'pt', 'ja', 'ko', 'zh-tw', 'id', 'th'];
const ALLOWED = new Set(DEFAULT_LANGS);
export function canonicalAsset(url) {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'assets.tcgdex.net' ||
        u.username || u.password || u.search || u.hash ||
        !/^\/[a-z0-9/_-]+$/i.test(u.pathname)) return null;
    return u.href.replace(/\/$/, '') + '.png';
  } catch { return null; }
}
export function mergeSets(languagesToSets) {
  const map = new Map();
  for (const [lang, sets] of Object.entries(languagesToSets)) {
    for (const set of sets) {
      if (!set || typeof set.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(set.id)) continue;
      const id = set.id;
      const entry = map.get(id) ?? { id, names: {}, symbols: {}, logos: {}, cardCounts: {} };
      if (typeof set.name === 'string') entry.names[lang] = set.name;
      const sym = canonicalAsset(set.symbol);
      const logo = canonicalAsset(set.logo);
      if (sym) entry.symbols[lang] = sym;
      if (logo) entry.logos[lang] = logo;
      if (Number.isInteger(set.cardCount?.total) && set.cardCount.total >= 0)
        entry.cardCounts[lang] = set.cardCount.total;
      map.set(id, entry);
    }
  }
  return [...map.values()].sort((a,b) => a.id.localeCompare(b.id));
}
async function fetchSets(lang, fetcher = fetch) {
  const response = await fetcher('https://api.tcgdex.net/v2/' + lang + '/sets', {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(lang + ': HTTP ' + response.status);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error(lang + ': unexpected response');
  return data;
}
export async function sync({ languages = DEFAULT_LANGS, output = 'data/symbols/tcgdex.json', fetcher = fetch } = {}) {
  for (const lang of languages) if (!ALLOWED.has(lang)) throw new Error('Unsupported language: ' + lang);
  const destination = path.resolve(ROOT, output);
  if (!(destination === ROOT || destination.startsWith(ROOT + path.sep))) throw new Error('Output path must stay in repository');
  let prior = null;
  try { prior = JSON.parse(await fs.readFile(destination, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const byLang = {};
  const failures = [];
  for (const lang of languages) {
    try { byLang[lang] = await fetchSets(lang, fetcher); console.log(lang + ': ' + byLang[lang].length + ' sets'); }
    catch (e) { failures.push({ language: lang, message: String(e.message) }); console.error(lang, e.message); }
  }
  if (!Object.keys(byLang).length) throw new Error('Every source failed; existing catalog preserved');
  const current = mergeSets(byLang);
  const merged = new Map((prior?.sets ?? []).map(s => [s.id, s]));
  // Keep older language images when one language is temporarily unavailable.
  for (const entry of current) {
    const old = merged.get(entry.id);
    merged.set(entry.id, old ? {
      ...old, ...entry,
      names: { ...old.names, ...entry.names },
      symbols: { ...old.symbols, ...entry.symbols },
      logos: { ...old.logos, ...entry.logos },
      cardCounts: { ...old.cardCounts, ...entry.cardCounts }
    } : entry);
  }
  const result = {
    schemaVersion: 1, source: 'TCGdex', sourceUrl: 'https://api.tcgdex.net/v2',
    updatedAt: new Date().toISOString(),
    languagesChecked: languages,
    languagesSucceeded: Object.keys(byLang),
    errors: failures,
    sets: [...merged.values()].sort((a,b) => a.id.localeCompare(b.id))
  };
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temp = destination + '.tmp';
  await fs.writeFile(temp, JSON.stringify(result, null, 2) + '\n');
  await fs.rename(temp, destination);
  console.log('Saved ' + result.sets.length + ' unique sets in ' + output);
  if (failures.length) process.exitCode = 1;
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const languages = process.env.SYMBOL_LANGUAGES?.split(',').map(x => x.trim()).filter(Boolean) ?? DEFAULT_LANGS;
  sync({ languages, output: process.env.SYMBOL_OUTPUT ?? 'data/symbols/tcgdex.json' }).catch(e => {
    console.error(e); process.exitCode = 1;
  });
}
