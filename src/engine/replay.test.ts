import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildFrames } from '../ui/replay';

it('recorded answers get their names back, and nothing coded is left', () => {
  for (const id of ['cafe', 'hoa', 'rescue']) {
    const run = JSON.parse(readFileSync(`public/recorded/${id}.json`, 'utf8'));
    const frames = buildFrames(run.snapshot);
    const last = frames[frames.length - 1].snap;
    for (const f of last.findings) {
      const shown = `${f.review?.explanation} ${f.review?.clientQuestion}`;
      expect(shown, `${id} ${f.kind}`).not.toMatch(/\b(PERSON|BUSINESS)_\d+\b/);
    }
  }
});
