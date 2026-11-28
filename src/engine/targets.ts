/** Objectifs R adaptatifs : TP1/TP2 fixes, TP3 extensible seulement si un
 * obstacle structurel mesuré laisse une marge suffisante. L'absence d'obstacle
 * identifié ne constitue pas une preuve d'espace libre jusqu'à 30R. */
export function targetMultiples(roomR: number): [number, number, number] {
  const tp3 = Number.isFinite(roomR) && roomR >= 10.5
    ? Math.max(8, Math.min(30, Math.floor(roomR - 0.5)))
    : 8;
  return [2, 5, tp3];
}

export function buildTargets(price: number, risk: number, dir: "BUY" | "SELL", roomR: number): [number, number, number] {
  const sign = dir === "BUY" ? 1 : -1;
  const digits = Math.abs(price) >= 1000 ? 2 : Math.abs(price) >= 10 ? 3 : 5;
  return targetMultiples(roomR).map(r => Number((price + sign * risk * r).toFixed(digits))) as [number, number, number];
}
