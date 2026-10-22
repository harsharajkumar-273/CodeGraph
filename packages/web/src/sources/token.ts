// A GitHub token, for private repositories and for GitHub's higher rate limit. It stays in this browser tab
// (sessionStorage, gone when the tab closes) and is only ever sent to api.github.com.
const KEY = 'codegraph.github-token';
let memory = '';

export function getToken(): string {
  if (memory) return memory;
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(value: string) {
  memory = value.trim();
  try {
    if (memory) sessionStorage.setItem(KEY, memory);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the token still works until the page is closed */
  }
}
