#!/usr/bin/env python3
"""Download 2y+ of public historical candles for Lucide Sniper.

Forex/Gold: Dukascopy public BI5 M1 candle feed (BID candles).
Crypto: Binance public Spot klines (BTCUSDT, ETHUSDT).
Outputs local CSV files; deliberately does not upload M1/M5 into D1 because
that volume can exceed practical D1 storage/write quotas. No API key required.
"""
from __future__ import annotations
import argparse, csv, datetime as dt, json, lzma, math, os, struct, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

FX_SYMBOLS = ["EURUSD","GBPUSD","USDJPY","USDCAD","USDCHF","AUDUSD","NZDUSD","EURGBP","EURJPY","EURCAD","GBPJPY","GBPCAD"]
SYMBOLS = ["XAUUSD", *FX_SYMBOLS, "BTCUSDT", "ETHUSDT"]


def utc_day(d: dt.date) -> int:
    return int(dt.datetime(d.year,d.month,d.day,tzinfo=dt.timezone.utc).timestamp()*1000)

def scale_for(symbol: str) -> int:
    if symbol == "XAUUSD": return 1000
    if symbol.endswith("JPY"): return 1000
    return 100000

def decode_candle_bi5(blob: bytes, day_start_ms: int, scale: int):
    """Decode 24-byte records: seconds, open, close, low, high, volume."""
    if not blob: return []
    raw = lzma.decompress(blob)
    rec = struct.Struct(">IIIIIf")
    if len(raw) % rec.size:
        raise ValueError(f"BI5 payload size {len(raw)} is not divisible by {rec.size}")
    out=[]
    for off in range(0,len(raw),rec.size):
        sec,o,c,l,h,v=rec.unpack_from(raw,off)
        vals=(o/scale,h/scale,l/scale,c/scale)
        if not all(math.isfinite(x) for x in vals) or h < max(o,c,l) or l > min(o,c):
            continue
        out.append((day_start_ms+sec*1000,*vals))
    return out

def fetch(url: str, timeout: int=25):
    req=urllib.request.Request(url,headers={"User-Agent":"LucideSniper-HistoricalResearch/1.0"})
    with urllib.request.urlopen(req,timeout=timeout) as r:
        return r.read()

def download_dukascopy_day(symbol: str, day: dt.date):
    # Dukascopy month is zero-indexed. Missing daily files are normal on weekends/holidays.
    url=(f"https://datafeed.dukascopy.com/datafeed/{symbol}/{day.year}/"
         f"{day.month-1:02d}/{day.day:02d}/BID_candles_min_1.bi5")
    try:
        return decode_candle_bi5(fetch(url),utc_day(day),scale_for(symbol))
    except urllib.error.HTTPError as e:
        if e.code in (403,404): return []
        raise

def aggregate(rows, minutes: int):
    out=[]; bucket=None; cur=None
    for t,o,h,l,c in rows:
        b=t//(minutes*60000)*(minutes*60000)
        if b!=bucket:
            if cur: out.append(cur)
            bucket=b; cur=[b,o,h,l,c]
        else:
            cur[2]=max(cur[2],h); cur[3]=min(cur[3],l); cur[4]=c
    if cur: out.append(cur)
    return out

def write_csv(path: Path, rows):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open("w",newline="",encoding="utf-8") as f:
        w=csv.writer(f); w.writerow(["timestamp","open","high","low","close"])
        for r in rows: w.writerow([r[0],*(f"{x:.8f}" for x in r[1:])])

def download_dukascopy(symbol,start,end,outdir):
    rows=[]; day=start; failures=[]
    total=(end-start).days+1
    while day<=end:
        try: rows.extend(download_dukascopy_day(symbol,day))
        except Exception as e: failures.append({"date":day.isoformat(),"error":str(e)[:180]})
        if (day-start).days%10==0: print(f"{symbol}: {(day-start).days+1}/{total} jours, {len(rows)} M1",flush=True)
        day+=dt.timedelta(days=1)
        time.sleep(0.08)
    rows.sort(key=lambda x:x[0])
    # Deduplicate timestamps, retaining the last source record.
    rows=list({r[0]:r for r in rows}.values()); rows.sort(key=lambda x:x[0])
    write_csv(outdir/symbol/"M1.csv",rows)
    counts={"M1":len(rows)}
    for tf,mins in (("M5",5),("M15",15),("M30",30),("H1",60),("H4",240),("D1",1440)):
        agg=aggregate(rows,mins); write_csv(outdir/symbol/f"{tf}.csv",agg); counts[tf]=len(agg)
    return {"symbol":symbol,**counts,"first":rows[0][0] if rows else None,"last":rows[-1][0] if rows else None,"download_errors":failures[:20]}

def download_binance(symbol,start,end,outdir):
    start_ms=utc_day(start); end_ms=utc_day(end+dt.timedelta(days=1))-1; rows=[]; cursor=start_ms
    while cursor<=end_ms:
        q=urllib.parse.urlencode({"symbol":symbol,"interval":"1m","startTime":cursor,"endTime":end_ms,"limit":1000})
        data=json.loads(fetch("https://api.binance.com/api/v3/klines?"+q))
        if not data: break
        for k in data: rows.append((int(k[0]),float(k[1]),float(k[2]),float(k[3]),float(k[4])))
        nxt=int(data[-1][0])+60000
        if nxt<=cursor: break
        cursor=nxt
        time.sleep(0.12)
    rows=list({r[0]:r for r in rows}.values()); rows.sort(key=lambda x:x[0])
    write_csv(outdir/symbol/"M1.csv",rows)
    counts={"M1":len(rows)}
    for tf,mins in (("M5",5),("M15",15),("M30",30),("H1",60),("H4",240),("D1",1440)):
        agg=aggregate(rows,mins); write_csv(outdir/symbol/f"{tf}.csv",agg); counts[tf]=len(agg)
    return {"symbol":symbol,**counts,"first":rows[0][0] if rows else None,"last":rows[-1][0] if rows else None,"download_errors":[]}

def main():
    p=argparse.ArgumentParser(description="Lucide Sniper: gratuit historical M1/M5 downloader")
    p.add_argument("--start",default=(dt.date.today()-dt.timedelta(days=730)).isoformat(),help="UTC YYYY-MM-DD")
    p.add_argument("--end",default=(dt.date.today()-dt.timedelta(days=1)).isoformat(),help="UTC YYYY-MM-DD")
    p.add_argument("--symbols",default="all",help="all, XAUUSD,EURUSD,...")
    p.add_argument("--out",default="./historical",help="Local output folder")
    a=p.parse_args(); start=dt.date.fromisoformat(a.start); end=dt.date.fromisoformat(a.end)
    if end<start: p.error("--end must be >= --start")
    selected=SYMBOLS if a.symbols.lower()=="all" else [x.strip().upper() for x in a.symbols.split(",")]
    unknown=set(selected)-set(SYMBOLS)
    if unknown: p.error("Unknown symbols: "+", ".join(sorted(unknown)))
    out=Path(a.out); report=[]
    for s in selected:
        print(f"\nDownloading {s} {start} → {end}",flush=True)
        report.append(download_binance(s,start,end,out) if s in ("BTCUSDT","ETHUSDT") else download_dukascopy(s,start,end,out))
    out.mkdir(parents=True,exist_ok=True)
    (out/"manifest.json").write_text(json.dumps({"source":"Dukascopy public BID M1 / Binance Spot M1","generated_utc":dt.datetime.now(dt.timezone.utc).isoformat(),"start":start.isoformat(),"end":end.isoformat(),"results":report},indent=2),encoding="utf-8")
    print("\nFinished. See",out/"manifest.json")

if __name__=="__main__": main()
