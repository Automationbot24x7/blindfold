// Pure helpers for the on-device leak guard (no Firebase imports, so they are unit-testable).

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
