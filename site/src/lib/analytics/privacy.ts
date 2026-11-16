export interface AnalyticsConfig {
  projectId: string;
  enabled: boolean;
  origin: string;
  page: string | null;
  paths: string[];
  query: Record<string, string[]>;
}

export function validProjectId(value: string): boolean { return /^[a-z0-9]{5,32}$/.test(value); }

/** Clarity captures native URLs too. Unknown paths, query values and fragments fail closed. */
export function safeLocation(url: URL, config: AnalyticsConfig): boolean {
  if (url.username || url.password || url.origin !== config.origin || !config.paths.includes(url.pathname)) return false;
  if (url.hash && !['#conteudo', '#resultados', '#trilhas', '#sql'].includes(url.hash)) return false;
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key) || !Object.hasOwn(config.query, key) || !config.query[key].includes(value)) return false;
    seen.add(key);
  }
  return true;
}

export function safeReferrer(value: string, config: AnalyticsConfig): boolean {
  if (!value) return true;
  try { return safeLocation(new URL(value), config); } catch { return false; }
}
