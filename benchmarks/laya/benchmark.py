#!/usr/bin/env python3
"""Standalone, dry-run Laya benchmark for HerThing voice routing."""

import argparse
import json
import os
import re
import resource
import statistics
import time
from pathlib import Path

import laya
import torch

HERE = Path(__file__).resolve().parent
DIRECT = {"pause_music", "resume_music", "next_track", "volume_up", "volume_down"}
SAFE = DIRECT | {"next_calendar_event", "current_weather"}


def conservative_rule(text):
    value = text.lower().strip()
    if re.search(r"\b(don't|do not|never|not)\b", value): return "fallback"
    if re.search(r"\b(said|say|phrase|quote|hypothetical|what would happen|if i)\b", value): return "fallback"
    hits = []
    patterns = {
        "pause_music": r"\b(pause|stop)\b.*\b(music|song|track|this)\b|\bstop the song\b",
        "resume_music": r"\b(resume|carry on|keep playing|play the music again)\b",
        "next_track": r"\b(skip|next|following)\b.*\b(song|track|it)\b",
        "volume_up": r"\b(turn|bring|volume|music|it).*(up|louder)|too quiet",
        "volume_down": r"\b(turn|bring|volume|it).*(down|quieter)|too loud",
        "next_calendar_event": r"\b(next|coming up).*(meeting|event|calendar)|\bcalendar.*next\b",
        "current_weather": r"\b(weather|conditions|outside|jacket)\b"
    }
    for action, pattern in patterns.items():
        if re.search(pattern, value): hits.append(action)
    if len(hits) != 1: return "fallback"
    if re.search(r"\b(and|then|also)\b", value): return "fallback"
    if re.search(r"\b(set|to)\s+\w*\s*(percent|%)\b", value): return "fallback"
    if hits[0] == "current_weather" and re.search(r"\b(tomorrow|friday|saturday|sunday|monday|tuesday|wednesday|thursday)\b|\bin\s+[A-Z][a-z]+", text): return "fallback"
    return hits[0]


def safety_gate(text, predicted, confidence, act_probability, threshold):
    rule = conservative_rule(text)
    if rule == "fallback" and predicted in SAFE: return "fallback"
    if predicted in SAFE and (confidence < threshold or act_probability < threshold): return "fallback"
    return predicted


def percentile(values, p):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int((len(ordered) - 1) * p)))]


def metrics(cases, predictions):
    correct = sum(case["expected"] == pred for case, pred in zip(cases, predictions))
    incorrect_direct = sum(pred in DIRECT and pred != case["expected"] for case, pred in zip(cases, predictions))
    fallback = sum(pred == "fallback" for pred in predictions)
    return {"accuracy": correct / len(cases), "correct": correct, "total": len(cases), "incorrect_direct_actions": incorrect_direct, "fallback_rate": fallback / len(cases)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--cases", default=str(HERE / "evaluation-cases.json"))
    parser.add_argument("--questions", default=str(HERE / "questions.json"))
    parser.add_argument("--threshold", type=float, default=.92)
    parser.add_argument("--warmup", type=int, default=2)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--output")
    args = parser.parse_args()
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    cases = json.loads(Path(args.cases).read_text())
    questions = json.loads(Path(args.questions).read_text())
    started = time.perf_counter()
    agent = laya.load(args.model, device="cpu")
    load_seconds = time.perf_counter() - started
    for _ in range(args.warmup): agent.predict({"transcript":"pause the music","context":{"music_playing":True}}, questions)
    raw, gated, timings, details = [], [], [], []
    for case in cases:
        state = {"transcript":case["text"], "context":case.get("context", {})}
        then = time.perf_counter(); result = agent.predict(state, questions); timings.append((time.perf_counter()-then)*1000)
        answer = result["answers"]["intent"]
        prediction = answer["choice"]
        raw.append(prediction)
        gated_prediction = safety_gate(case["text"], prediction, answer["confidence"], answer["action"]["act_probability"], args.threshold)
        gated.append(gated_prediction)
        details.append({"id":case["id"],"text":case["text"],"expected":case["expected"],"laya":prediction,"gated":gated_prediction,"confidence":answer["confidence"],"act_probability":answer["action"]["act_probability"],"latency_ms":round(timings[-1],1)})
    rules = [conservative_rule(case["text"]) for case in cases]
    long_state = {"transcript":" ".join(["ordinary"]*1200)}
    long_result = agent.predict(long_state, questions)
    report = {
        "environment":{"cpu":"Intel Core i5-3210M","cores":2,"threads":4,"torch":torch.__version__,"torch_threads":args.threads,"model":os.path.realpath(args.model)},
        "load_seconds":round(load_seconds,3),
        "peak_rss_mib":round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,1),
        "warm_latency_ms":{"p50":round(statistics.median(timings),1),"p95":round(percentile(timings,.95),1),"min":round(min(timings),1),"max":round(max(timings),1)},
        "input_limit":{"configured":agent.cfg.get("max_len"),"long_input_tokens_used":long_result["usage"]["input_tokens"]},
        "laya":metrics(cases,raw),"gated_laya":metrics(cases,gated),"simple_rules":metrics(cases,rules),"cases":details
    }
    encoded = json.dumps(report, indent=2)
    if args.output: Path(args.output).write_text(encoded+"\n")
    print(encoded)


if __name__ == "__main__": main()
