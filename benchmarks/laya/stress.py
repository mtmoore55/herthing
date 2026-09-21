#!/usr/bin/env python3
"""Keep Laya busy long enough for external responsiveness probes."""
import argparse, json, time
from pathlib import Path
import laya, torch

p=argparse.ArgumentParser();p.add_argument('--model',required=True);p.add_argument('--iterations',type=int,default=8);a=p.parse_args()
torch.set_num_threads(2);torch.set_num_interop_threads(1)
questions=json.loads((Path(__file__).parent/'questions.json').read_text())
agent=laya.load(a.model,device='cpu');print('READY',flush=True)
for i in range(a.iterations):
    started=time.perf_counter();agent.predict({'transcript':'please pause this music now'},questions)
    print(json.dumps({'iteration':i+1,'latency_ms':round((time.perf_counter()-started)*1000,1)}),flush=True)
