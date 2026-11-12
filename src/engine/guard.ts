// Pure helpers for the on-device leak guard (no Firebase imports, so they are unit-testable).
import { SAFE_WORDS } from './safewords';

// Everyday words that are also first names: if the leak guard flags one of these, believe it.
const NAME_LIKE = new Set(['april', 'may', 'june', 'july', 'august', 'summer', 'autumn', 'dawn', 'joy', 'faith', 'hope', 'grace', 'rose', 'sky', 'star', 'sunny', 'chase', 'page', 'lane']);

/**
 * Notes are already default-deny, so most of what the guard can see is everyday vocabulary.
 * A hit on such a word ("CASH", "CARD") is noise, unless the word doubles as a first name.
 */
export function usefulHits(hits: string[]): string[] {
  return hits.filter(h => h.split(/\s+/).some(w => {
    const x = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    return x.length >= 2 && (!SAFE_WORDS.has(x) || NAME_LIKE.has(x));
  }));
}

/**
 * The model sometimes returns part of a word ("arav" for "aarav"). Expand every hit to the
 * whole words that contain it, so masking can never leave the rest of a name behind.
 */
export function expandHits(leaks: string[], text: string): string[] {
  const out = new Set<string>();
  for (const raw of leaks) {
    const s = raw.trim();
    if (s.length < 2 || /^\[[A-Z]+_\d+\]$/.test(s)) continue;
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const m of text.matchAll(new RegExp(`[\\p{L}\\p{N}'’.-]*${esc}[\\p{L}\\p{N}'’.-]*`, 'giu'))) {
      const w = m[0].replace(/^[.'’-]+|[.'’-]+$/g, '');
      if (w.length >= 2 && !/^\[?[A-Z]+_\d+\]?$/.test(w)) out.add(w);
    }
  }
  return [...out];
}
