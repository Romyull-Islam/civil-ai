/**
 * Deployment modes:
 *  - "byok"    (developer/self-host): every user pastes their own API keys in Settings; no accounts.
 *  - "desktop" (Electron):    built-in local model + optional keys; single user, no accounts.
 *  - "saas"    (default, your product): accounts, roles (admin/user), subscription plans, server-held keys, quotas. Users never see keys.
 */
export type AppMode = "saas" | "byok" | "desktop";
export function appMode(): AppMode {
  const m = process.env.CIVIL_AI_MODE;
  if (m === "saas" || m === "byok" || m === "desktop") return m;
  if (process.env.CIVIL_AI_DESKTOP) return "desktop";
  return "saas"; // the product default: accounts + subscriptions; set CIVIL_AI_MODE=byok for a keys-in-browser developer instance
}
