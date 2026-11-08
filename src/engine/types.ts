export interface Candle { t: number; o: number; h: number; l: number; c: number } // t = ouverture, epoch ms UTC
export type Dir = "BUY" | "SELL";
export interface Pivot { i: number; t: number; price: number; isHigh: boolean }
export interface Zone { kind: "OB" | "FVG" | "SD"; dir: Dir; top: number; bottom: number; i: number; t: number; touches: number; tf: string }
export interface StructureEvent { type: "BOS" | "CHoCH"; dir: Dir; level: number; barsAgo: number }
export interface Structure { trend: "up" | "down" | "range"; event: StructureEvent | null }
export interface Sweep { dir: Dir; level: number; wick: number; barsAgo: number }
export interface WyckoffInfo { phase: "accumulation" | "distribution" | "markup" | "markdown" | "none"; event: "spring" | "upthrust" | "SOS" | "SOW" | null; bias: Dir | null; top: number | null; bottom: number | null }
export interface PatternInfo { name: string; dir: Dir; confirmed: boolean; level: number }
export interface Gate { name: string; ok: boolean; detail: string }
export interface Evaluation { dir: Dir; gates: Gate[]; score: number; reasons: string[]; tags: string[]; entry: number; sl: number; tps: [number, number, number]; rr: string; passed: boolean }
