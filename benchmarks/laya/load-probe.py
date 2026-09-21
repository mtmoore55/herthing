#!/usr/bin/env python3
"""Measure host health responsiveness while Laya loads and infers."""

import argparse
import json
import statistics
import subprocess
import threading
import time

import laya
import torch


def percentile(values, p):
    ordered = sorted(values)
    return ordered[min(len(ordered)-1, int((len(ordered)-1)*p))]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--health", default="http://172.16.42.1:8787/health")
    parser.add_argument("--iterations", type=int, default=3)
    args = parser.parse_args()
    torch.set_num_threads(2); torch.set_num_interop_threads(1)
    stop = threading.Event(); samples=[]; failures=0
    def poll():
        nonlocal failures
        while not stop.is_set():
            started=time.perf_counter()
            try:
                subprocess.run(["curl","-fsS","--max-time","2",args.health],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
                samples.append((time.perf_counter()-started)*1000)
            except Exception: failures += 1
            stop.wait(.1)
    thread=threading.Thread(target=poll,daemon=True); thread.start()
    questions={"intent":{"type":"choice","instructions":"Classify this voice command.","criteria":{"pause_music":"pause music now","next_track":"skip song now","fallback":"anything else"}}}
    started=time.perf_counter(); agent=laya.load(args.model,device="cpu"); load=time.perf_counter()-started
    inference=[]
    for text in ["pause the music","skip this song","how are you"][:args.iterations]:
        started=time.perf_counter(); agent.predict({"transcript":text},questions); inference.append((time.perf_counter()-started)*1000)
    stop.set(); thread.join(timeout=2)
    health={"p50":round(statistics.median(samples),1),"p95":round(percentile(samples,.95),1),"max":round(max(samples),1)} if samples else None
    print(json.dumps({"load_seconds":round(load,3),"inference_ms":[round(v,1) for v in inference],"health_samples":len(samples),"health_failures":failures,"health_latency_ms":health},indent=2))


if __name__ == "__main__": main()
