// Tiny shared flag: is the audit screen currently showing a recorded run?
import { useEffect, useState } from 'react';

let replaying = false;
const subs = new Set<(v: boolean) => void>();

export function setReplaying(v: boolean): void {
  replaying = v;
  subs.forEach(s => s(v));
}

export function useReplaying(): boolean {
  const [v, setV] = useState(replaying);
  useEffect(() => {
    subs.add(setV);
    setV(replaying);
    return () => { subs.delete(setV); };
  }, []);
  return v;
}
