import { Candle, Dir, Zone } from "./types";

export interface CRTSetup {
  dir: Dir;
  referenceTime: number;
  high: number;
  low: number;
  midpoint: number;
  sweepExtreme: number;
  barsAgo: number;
}

// Candle Range Theory : une bougie de référence est balayée, puis le prix clôture de nouveau dans sa range.
export function detectCRT(c: Candle[], lookback = 8, maxBarsAfter = 3): CRTSetup | null {
  if (c.length < 4) return null;
  const last = c.length - 1;
  for (let ref = last - 1; ref >= Math.max(0, last - lookback); ref--) {
    const r = c[ref];
    if (!(r.h > r.l)) continue;
    for (let k = last; k > ref && k >= Math.max(ref + 1, last - maxBarsAfter + 1); k--) {
      // Sweep du low puis réintégration : biais acheteur.
      if (c[k].l < r.l && c[k].c > r.l && c[k].c < r.h) {
        return { dir: "BUY", referenceTime: r.t, high: r.h, low: r.l, midpoint: (r.h + r.l) / 2, sweepExtreme: c[k].l, barsAgo: last - k };
      }
      // Sweep du high puis réintégration : biais vendeur.
      if (c[k].h > r.h && c[k].c < r.h && c[k].c > r.l) {
        return { dir: "SELL", referenceTime: r.t, high: r.h, low: r.l, midpoint: (r.h + r.l) / 2, sweepExtreme: c[k].h, barsAgo: last - k };
      }
    }
  }
  return null;
}

export interface KillzoneInfo { active: boolean; name: "London" | "New York" | "none"; localTime: string }
export interface AsianRange { high: number; low: number; sessionDate: string; candles: number }

// Range asiatique ICT : 20:00–00:00 heure de New York. On utilise le fuseau IANA
// afin que le calcul reste juste lors des changements d'heure été/hiver.
export function getAsianRange(candles: Candle[], now: number): AsianRange | null {
  const sessions = new Map<string, { high: number; low: number; candles: number; lastTime: number }>();
  for (const candle of candles) {
    if (!Number.isFinite(candle.t) || candle.t > now || !(candle.h >= candle.l)) continue;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date(candle.t));
    const get = (type: string) => parts.find(part => part.type === type)?.value ?? "00";
    const hour = Number(get("hour"));
    if (hour < 20) continue;
    const key = `${get("year")}-${get("month")}-${get("day")}`;
    const existing = sessions.get(key);
    if (!existing) sessions.set(key, { high: candle.h, low: candle.l, candles: 1, lastTime: candle.t });
    else {
      existing.high = Math.max(existing.high, candle.h);
      existing.low = Math.min(existing.low, candle.l);
      existing.candles++;
      existing.lastTime = Math.max(existing.lastTime, candle.t);
    }
  }
  const latest = [...sessions.entries()].sort((a, b) => b[1].lastTime - a[1].lastTime)[0];
  if (!latest || latest[1].candles < 2 || !(latest[1].high > latest[1].low)) return null;
  return { high: latest[1].high, low: latest[1].low, sessionDate: latest[0], candles: latest[1].candles };
}

// Confirme uniquement un balayage de l'extrême asiatique suivi d'une réintégration.
// Cette information ajoute du contexte ; elle ne constitue jamais un prérequis au setup.
export function sweptAsianRange(candles: Candle[], range: AsianRange | null, dir: "BUY" | "SELL", lookback = 8): boolean {
  if (!range || candles.length === 0) return false;
  return candles.slice(-lookback).some(candle => dir === "BUY"
    ? candle.l < range.low && candle.c > range.low
    : candle.h > range.high && candle.c < range.high);
}
function localClock(ts: number, timeZone: string): { hour: number; minute: number; weekday: string; text: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ts));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "00";
  return { hour: Number(get("hour")), minute: Number(get("minute")), weekday: get("weekday"), text: `${get("hour")}:${get("minute")}` };
}
// Fenêtres ICT couramment utilisées : Londres 07:00–10:00 et New York 07:00–10:00, heures locales avec DST.
export function getKillzone(ts: number): KillzoneInfo {
  const london = localClock(ts, "Europe/London");
  if (london.weekday !== "Sat" && london.weekday !== "Sun" && london.hour >= 7 && london.hour < 10) return { active: true, name: "London", localTime: london.text };
  const ny = localClock(ts, "America/New_York");
  if (ny.weekday !== "Sat" && ny.weekday !== "Sun" && ny.hour >= 7 && ny.hour < 10) return { active: true, name: "New York", localTime: ny.text };
  return { active: false, name: "none", localTime: `${london.text} Londres / ${ny.text} New York` };
}

// Breaker block : ancien OB invalidé par clôture, puis repris dans le sens opposé.
export function detectBreakerBlocks(c: Candle[], a: number[], tf: string, maxAge = 100): Zone[] {
  const out: Zone[] = [], n = c.length, start = Math.max(1, n - maxAge);
  for (let i = start; i < n - 2; i++) {
    const atr = a[i]; if (!(atr > 0)) continue;
    const base = c[i], next = c.slice(i + 1, Math.min(n, i + 4));
    const bullishOB = base.c < base.o && next.some(x => x.c > base.h && x.c - base.c >= 1.2 * atr);
    const bearishOB = base.c > base.o && next.some(x => x.c < base.l && base.c - x.c >= 1.2 * atr);
    if (!bullishOB && !bearishOB) continue;
    let invalid = -1;
    for (let j = i + 1; j < n; j++) {
      if (bullishOB ? c[j].c < base.l : c[j].c > base.h) { invalid = j; break; }
    }
    if (invalid < 0 || invalid === n - 1) continue;
    // Après invalidation, retour/clôture dans la zone = breaker actif.
    const retest = c.slice(invalid + 1).some(x => bullishOB ? x.h >= base.l && x.c < base.l : x.l <= base.h && x.c > base.h);
    if (!retest) continue;
    const top = base.h, bottom = base.l;
    out.push({ kind: "BREAKER", dir: bullishOB ? "SELL" : "BUY", top, bottom, i, t: base.t, touches: 1, tf });
  }
  return out;
}
