import importlib.util, struct, lzma, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('history','scripts/download_history.py')
h=importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
class DownloaderTests(unittest.TestCase):
    def test_bi5_decode(self):
        raw=struct.pack('>IIIIIf',0,100000,100500,99900,100700,1.0)
        rows=h.decode_candle_bi5(lzma.compress(raw,format=lzma.FORMAT_ALONE),1700000000000,100000)
        self.assertEqual(len(rows),1); self.assertEqual(rows[0][1:],(1.0,1.007,0.999,1.005))
    def test_bad_payload_rejected(self):
        with self.assertRaises(Exception): h.decode_candle_bi5(b'bad',0,100000)
    def test_aggregate_ohlc(self):
        rows=[(0,1,2,.5,1.5),(60000,1.5,2.5,1,2),(120000,2,3,1.8,2.5)]
        out=h.aggregate(rows,5)
        self.assertEqual(len(out),1); self.assertEqual(tuple(out[0][1:]),(1,3,.5,2.5))
    def test_market_coverage(self):
        self.assertEqual(len(h.SYMBOLS),15); self.assertEqual(len(set(h.SYMBOLS)),15)
        self.assertIn('XAUUSD',h.SYMBOLS); self.assertIn('BTCUSDT',h.SYMBOLS); self.assertIn('ETHUSDT',h.SYMBOLS)
if __name__=='__main__': unittest.main()
