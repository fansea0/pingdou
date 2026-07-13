const KEY = 'pingdou.sid';

export function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let sid = sessionStorage.getItem(KEY);
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem(KEY, sid);
    }
    return sid;
  } catch {
    return '';
  }
}