import { useEffect } from 'react';

/**
 * Reads something for `key` and reads it again each time the page regains the
 * focus, so it arrives without a reload; each answer goes to `apply`. A null
 * key reads nothing. A read that fails leaves what was there until the next
 * focus. `read` and `apply` are taken as they are when the key changes, so
 * pass ones that do not change between renders (a state setter, a module function).
 */
export function useReadOnFocus<K, T>(key: K | null, read: (key: K) => Promise<T>, apply: (value: T) => void): void {
  useEffect(() => {
    if (key === null) return;
    let stale = false;
    const load = () =>
      read(key).then(
        (value) => !stale && apply(value),
        () => {},
      );
    load();
    window.addEventListener('focus', load);
    return () => {
      stale = true;
      window.removeEventListener('focus', load);
    };
  }, [key]); // read and apply are stable by contract
}
