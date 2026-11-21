/**
 * Mémorisation locale des serveurs multijoueur récents (`localStorage`).
 * Conserve l'adresse, le pseudo et le mot de passe pour éviter de les retaper à chaque partie.
 */

export interface RecentServer {
  address: string;
  name: string;
  password: string;
  lastUsed: number;
}

const SERVERS_KEY = 'sarihbricks.servers';
const PSEUDO_KEY = 'sarihbricks.lastPseudo';
const MAX_RECENT = 8;

export function loadRecentServers(): RecentServer[] {
  try {
    const raw = localStorage.getItem(SERVERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is RecentServer =>
          x &&
          typeof x === 'object' &&
          typeof x.address === 'string' &&
          typeof x.name === 'string' &&
          typeof x.password === 'string',
      )
      .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function saveRecentServer(entry: { address: string; name: string; password: string }): void {
  try {
    if (entry.name.trim()) localStorage.setItem(PSEUDO_KEY, entry.name.trim());
    const addr = entry.address.trim();
    if (!addr) return;
    const list = loadRecentServers().filter((s) => s.address.toLowerCase() !== addr.toLowerCase());
    list.unshift({
      address: addr,
      name: entry.name.trim(),
      password: entry.password,
      lastUsed: Date.now(),
    });
    localStorage.setItem(SERVERS_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // localStorage indisponible
  }
}

export function removeRecentServer(address: string): void {
  try {
    const list = loadRecentServers().filter((s) => s.address.toLowerCase() !== address.trim().toLowerCase());
    localStorage.setItem(SERVERS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function loadLastPseudo(): string {
  try {
    return localStorage.getItem(PSEUDO_KEY) ?? '';
  } catch {
    return '';
  }
}
