// Firebase Remote Config: audit thresholds and model names can change without a redeploy.
import { fetchAndActivate, getAll, getRemoteConfig } from 'firebase/remote-config';
import { firebaseApp } from './firebase';
import { DEFAULT_CONFIG, type AuditConfig, type Currency } from '../engine/detectors';

export interface AppConfig {
  cloudModel: string;
  cloudFallbackModel: string;
  deviceBatchSize: number;
  audit: Record<Currency, AuditConfig>;
  fetchedAt?: string;
  source: 'defaults' | 'remote';
}

const CURRENCIES: Currency[] = ['USD', 'EUR', 'GBP', 'INR'];

const defaults: Record<string, string | number> = {
  cloud_model: 'gemini-3.5-flash-lite',
  cloud_fallback_model: 'gemini-3.8-flash',
  device_batch_size: 12,
  duplicate_window_days: DEFAULT_CONFIG.USD.duplicateWindowDays,
  round_trip_window_days: DEFAULT_CONFIG.USD.roundTripWindowDays,
  ...Object.fromEntries(CURRENCIES.flatMap(c => [
    [`cash_threshold_${c.toLowerCase()}`, DEFAULT_CONFIG[c].cashThreshold],
    [`approval_limit_${c.toLowerCase()}`, DEFAULT_CONFIG[c].approvalLimit],
  ])),
};

let current: AppConfig = build(defaults, 'defaults');

function build(v: Record<string, string | number>, source: AppConfig['source'], fetchedAt?: string): AppConfig {
  const n = (k: string) => Number(v[k]);
  const shared = { duplicateWindowDays: n('duplicate_window_days'), roundTripWindowDays: n('round_trip_window_days') };
  return {
    cloudModel: String(v.cloud_model),
    cloudFallbackModel: String(v.cloud_fallback_model),
    deviceBatchSize: n('device_batch_size'),
    audit: Object.fromEntries(CURRENCIES.map(c => [c, {
      ...DEFAULT_CONFIG[c], ...shared,
      cashThreshold: n(`cash_threshold_${c.toLowerCase()}`), approvalLimit: n(`approval_limit_${c.toLowerCase()}`),
    }])) as Record<Currency, AuditConfig>,
    source,
    fetchedAt,
  };
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const rc = getRemoteConfig(firebaseApp);
    rc.settings.minimumFetchIntervalMillis = 60_000;
    rc.settings.fetchTimeoutMillis = 8_000;
    rc.defaultConfig = defaults;
    await fetchAndActivate(rc);
    const all = getAll(rc);
    const values = Object.fromEntries(Object.entries(all).map(([k, val]) => [k, val.asString()]));
    const remote = Object.values(all).some(val => val.getSource() === 'remote');
    current = build({ ...defaults, ...values }, remote ? 'remote' : 'defaults', new Date().toLocaleTimeString());
  } catch {
    current = build(defaults, 'defaults');
  }
  return current;
}

export const appConfig = () => current;
