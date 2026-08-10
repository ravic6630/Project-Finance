// Native (Capacitor) integration. Every export is safe to call on the web —
// the plugins are dynamically imported and no-op'd off-device, so the browser
// build never pays for them and never crashes on a missing bridge.
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
export const isIOS = platform === 'ios';

// Store policy: Apple (3.1.1) and Google both require their own billing for
// digital subscriptions, and reject apps that sell around it. The native build
// therefore shows no purchase path at all — existing Premium members keep every
// feature, and upgrading happens on the web. Flip this to true only once real
// StoreKit / Play Billing is wired up.
export const canPurchaseInApp = !isNative;

// Bundled builds load from capacitor://localhost, so API calls need an
// absolute origin. VITE_API_BASE overrides it for staging builds.
export const API_ORIGIN = isNative
  ? import.meta.env.VITE_API_BASE || 'https://sampada-j9hi.onrender.com'
  : '';

const safe = async (fn) => {
  try {
    return await fn();
  } catch {
    return null; // a missing/!implemented plugin must never break a screen
  }
};

/* --------------------------------- haptics -------------------------------- */
// Light physical feedback on the moments that matter (saved, milestone, error).
export async function haptic(kind = 'light') {
  if (!isNative) return;
  await safe(async () => {
    const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
    if (kind === 'success') return Haptics.notification({ type: NotificationType.Success });
    if (kind === 'warning') return Haptics.notification({ type: NotificationType.Warning });
    if (kind === 'error') return Haptics.notification({ type: NotificationType.Error });
    const style = kind === 'heavy' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light;
    return Haptics.impact({ style });
  });
}

/* ---------------------------------- share --------------------------------- */
// Native share sheet (referral link, statements). Falls back to the Web Share
// API, then to the clipboard, so callers never need to branch.
export async function shareContent({ title, text, url }) {
  if (isNative) {
    const done = await safe(async () => {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text, url, dialogTitle: title });
      return true;
    });
    if (done) return true;
  }
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch {
      return false; // user dismissed
    }
  }
  try {
    await navigator.clipboard.writeText(url || text || '');
    return 'copied';
  } catch {
    return false;
  }
}

/* -------------------------------- browser --------------------------------- */
// External links must leave the app's webview, or the user gets stranded on a
// page with no chrome. In-app browser on native, new tab on web.
export async function openExternal(url) {
  if (isNative) {
    const done = await safe(async () => {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url, presentationStyle: 'popover' });
      return true;
    });
    if (done) return;
  }
  window.open(url, '_blank', 'noopener');
}

/* -------------------------------- biometrics ------------------------------- */
// Face ID / Touch ID / fingerprint. Reported capability drives whether the
// app-lock setting is offered at all.
export async function biometricAvailable() {
  if (!isNative) return { available: false, name: null };
  const res = await safe(async () => {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    const info = await BiometricAuth.checkBiometry();
    return {
      available: !!info.isAvailable,
      // 'Face ID' / 'Touch ID' / 'Fingerprint' — used verbatim in the UI copy.
      name: info.biometryType ? String(info.strongReason || '').trim() || null : null,
      type: info.biometryType ?? 0,
    };
  });
  return res || { available: false, name: null };
}

export async function biometricUnlock(reason = 'Unlock Sampada') {
  if (!isNative) return true;
  const res = await safe(async () => {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: 'Cancel',
      allowDeviceCredential: true, // passcode fallback, so nobody is locked out
      iosFallbackTitle: 'Use passcode',
      androidTitle: 'Unlock Sampada',
      androidSubtitle: reason,
    });
    return true;
  });
  return res === true;
}

/* ------------------------------ shell wiring ------------------------------- */
let statusBarApplied = null;

// Keep the OS status bar in step with the in-app theme (light text on the navy
// dark theme, dark text on the cream light theme).
export async function syncStatusBar(theme) {
  if (!isNative || statusBarApplied === theme) return;
  statusBarApplied = theme;
  await safe(async () => {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light });
    if (platform === 'android') {
      await StatusBar.setBackgroundColor({ color: theme === 'dark' ? '#0d1626' : '#faf9f5' });
    }
  });
}

// Called once at boot: hide the splash, wire the Android back button to router
// history, and expose connectivity changes.
export async function initNative({ onBack, onNetworkChange } = {}) {
  if (!isNative) return;

  await safe(async () => {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  });

  await safe(async () => {
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', ({ canGoBack }) => {
      // Android's hardware back should feel like the browser's: go back through
      // in-app history, and only exit from the root.
      if (onBack?.() === true) return;
      if (canGoBack && window.history.length > 1) window.history.back();
      else App.exitApp();
    });
  });

  await safe(async () => {
    const { Network } = await import('@capacitor/network');
    const status = await Network.getStatus();
    onNetworkChange?.(status.connected);
    Network.addListener('networkStatusChange', (s) => onNetworkChange?.(s.connected));
  });
}
