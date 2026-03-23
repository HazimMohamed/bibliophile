import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export async function configureNativeChrome() {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.classList.add('native-shell');

  try {
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    // Ignore unsupported platforms or transient plugin failures.
  }

  try {
    await StatusBar.setBackgroundColor({ color: '#ece3d2' });
  } catch {
    // Some platforms ignore background color updates.
  }

  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    // Ignore — CSS safe-area-inset-top handles the clearance.
  }
}
