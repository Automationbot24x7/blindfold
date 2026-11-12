// Firebase wiring: app, App Check, AI Logic (hybrid), Remote Config.
// Every AI call in this app goes through the models created here.
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  type GenerativeModel,
  type LanguageModelPromptOptions,
  type ModelParams,
} from 'firebase/ai';

const env = import.meta.env;

export const firebaseApp = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});

// App Check protects the cloud model from abuse. On localhost we use the debug provider
// (its token is registered in the Firebase console); the hosted site uses reCAPTCHA Enterprise
// (Google Cloud Fraud Defense), whose site key is public and lives in .env.production.
// The debug path exists only in development builds; production builds never contain it.
if (import.meta.env.DEV && ['localhost', '127.0.0.1'].includes(location.hostname)) {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
}
export const appCheck = initializeAppCheck(firebaseApp, {
  provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_SITE_KEY || 'debug-only'),
  isTokenAutoRefreshEnabled: true,
});

export const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });

/**
 * A model that can ONLY run on this device. Raw statement text is only ever sent here:
 * if the on-device model is missing, the SDK throws instead of silently using the cloud.
 */
export function deviceModel(promptOptions?: LanguageModelPromptOptions): GenerativeModel {
  return getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      },
      promptOptions,
    },
  });
}

/** A model that can ONLY run in the cloud. It only ever receives masked text. */
export function cloudModel(inCloudParams: ModelParams): GenerativeModel {
  return getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams });
}

/**
 * Cloud first, device as the safety net: used for masked text only. If the cloud is busy,
 * blocked or the laptop is offline, the SDK falls back to the on-device model and reports it.
 */
export function cloudFirstModel(inCloudParams: ModelParams, promptOptions?: LanguageModelPromptOptions, timeoutMs = 25_000): GenerativeModel {
  return getGenerativeModel(
    ai,
    {
      mode: InferenceMode.PREFER_IN_CLOUD,
      inCloudParams,
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: 'text', languages: ['en'] }],
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
        },
        promptOptions,
      },
    },
    // A busy free-tier model should not stall the audit: after this, the device takes over.
    { timeout: timeoutMs },
  );
}
