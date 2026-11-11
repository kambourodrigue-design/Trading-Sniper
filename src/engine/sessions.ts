import type { SymbolCfg } from "./config";

// Séance ouverte ? (fx : dim 22h → ven 22h UTC ; us : 9h30-16h New York, jours ouvrés, heure d'été gérée ; crypto : toujours)
export function isMarketOpen(s: SymbolCfg, now: number): boolean {
  if (s.session === "crypto") return true;
  const d = new Date(now);
  if (s.session === "us") {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const mins = Number(get("hour")) * 60 + Number(get("minute"));
    return get("weekday") !== "Sat" && get("weekday") !== "Sun" && mins >= 9 * 60 + 30 && mins < 16 * 60;
  }
  const day = d.getUTCDay(), h = d.getUTCHours();
  return !(day === 6 || (day === 5 && h >= 22) || (day === 0 && h < 22));
}
