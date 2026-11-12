// On-device model status for the UI (Chrome's built-in model, used through Firebase AI Logic).
import { useEffect, useState } from 'react';
import { deviceModel } from './firebase';

export type DeviceStatus = 'checking' | 'available' | 'downloadable' | 'downloading' | 'unavailable';

interface LanguageModelApi {
  availability: (o?: object) => Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
}

const options = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

export async function deviceAvailability(): Promise<DeviceStatus> {
  const lm = (globalThis as unknown as { LanguageModel?: LanguageModelApi }).LanguageModel;
  if (!lm) return 'unavailable';
  try {
    // Some browsers expose the API but never answer; don't leave the page "checking" forever.
    return await Promise.race([lm.availability(options), new Promise<'unavailable'>(r => setTimeout(() => r('unavailable'), 4000))]);
  } catch {
    return 'unavailable';
  }
}

let shared: { status: DeviceStatus; progress: number } = { status: 'checking', progress: 0 };
const listeners = new Set<(s: typeof shared) => void>();
const set = (s: Partial<typeof shared>) => { shared = { ...shared, ...s }; listeners.forEach(l => l(shared)); };

void deviceAvailability().then(status => set({ status }));

/** Must be called from a click: Chrome only starts the model download after a user gesture. */
export function prepareDevice(): void {
  set({ status: 'downloading', progress: 0 });
  deviceModel()
    .initializeDeviceModel(p => set({ status: 'downloading', progress: p }))
    .then(async () => set({ status: await deviceAvailability(), progress: 1 }))
    .catch(async () => set({ status: await deviceAvailability() }));
}

export function useDevice() {
  const [s, setS] = useState(shared);
  useEffect(() => {
    listeners.add(setS);
    setS(shared); // catch up with any change made before this component subscribed
    return () => { listeners.delete(setS); };
  }, []);
  return s;
}

export function useOnline(): boolean {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false);
    addEventListener('online', up);
    addEventListener('offline', down);
    return () => { removeEventListener('online', up); removeEventListener('offline', down); };
  }, []);
  return on;
}
