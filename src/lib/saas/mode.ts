/**
 * Deployment modes:
 *  - "company" (self-hosted company edition): accounts managed by the company's admin, the company's own AI keys or local
 *    model, no payments and no connection to CivilMate's servers (see lib/company).
 *  - "byok"    (developer/self-host): every user pastes their own API keys in Settings; no accounts.
 *  - "desktop" (Electron):    built-in local model + optional keys; single user, no accounts.
 *  - "saas"    (default, your product): accounts, roles (admin/user), subscription plans, server-held keys, quotas. Users never see keys.
 */
export type AppMode = "saas" | "byok" | "desktop" | "company";
export function appMode(): AppMode {
  const m = process.env.CIVIL_AI_MODE;
  if (m === "saas" || m === "byok" || m === "desktop" || m === "company") return m;
  if (process.env.CIVIL_AI_DESKTOP) return "desktop";
  return "saas"; // the product default: accounts + subscriptions; set CIVIL_AI_MODE=byok for a keys-in-browser developer instance
}

/** Modes with user accounts, roles and server-held keys (hosted service and company installs). */
export const hasAccounts = (m: AppMode = appMode()) => m === "saas" || m === "company";
export const isCompany = () => appMode() === "company";
