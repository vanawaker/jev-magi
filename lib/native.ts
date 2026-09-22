import type { MouseEvent } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';

// The packaged app has no local server: votes go to TypeSafe through the native HTTP client,
// and the key is kept on the device.
export const native = isTauri();
export const loadKey = () => invoke<string | null>('load_key');
// Without a system keyring (some Linux desktops) saving fails and the key lasts for this session only.
export const saveKey = (key: string) => invoke<void>('save_key', { key });
export const clearKey = () => invoke<void>('clear_key');
export const transport: typeof fetch = (input, init) => nativeFetch(input instanceof Request ? input : String(input), { ...init, maxRedirections: 0 });

// Links open in the system browser; the app window never navigates away.
export function openExternal(event: MouseEvent<HTMLAnchorElement>) {
  if (!native) return;
  event.preventDefault();
  void openUrl(event.currentTarget.href);
}
