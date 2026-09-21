#!/usr/bin/env python3
"""Resident JSON-lines prototype for local Laya routing.

Input:  {"id":"1","transcript":"pause the music","context":{...}}
Output: {"id":"1","ok":true,"result":{...},"elapsed_ms":...}
"""
import argparse, json, sys, time
from pathlib import Path
import laya, torch

p=argparse.ArgumentParser();p.add_argument('--model',required=True);p.add_argument('--threads',type=int,default=2);p.add_argument('--questions',default=str(Path(__file__).parent/'questions.json'));a=p.parse_args()
torch.set_num_threads(a.threads);torch.set_num_interop_threads(1)
questions=json.loads(Path(a.questions).read_text())
started=time.perf_counter();agent=laya.load(a.model,device='cpu')
print(json.dumps({'type':'ready','load_ms':round((time.perf_counter()-started)*1000),'max_input_tokens':agent.cfg.get('max_len',512)}),flush=True)
for line in sys.stdin:
    try:
        request=json.loads(line);started=time.perf_counter()
        result=agent.predict({'transcript':str(request.get('transcript','')),'context':request.get('context',{})},questions)
        print(json.dumps({'id':request.get('id'),'ok':True,'elapsed_ms':round((time.perf_counter()-started)*1000,1),'result':result}),flush=True)
    except Exception as error:
        print(json.dumps({'id':request.get('id') if 'request' in locals() else None,'ok':False,'error':str(error)}),flush=True)
