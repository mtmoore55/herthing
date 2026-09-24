# Jev evaluation for HerThing

Research checked against TypeSafe's official documentation on 2026-09-24.
Status: research only; no API calls, credentials, SDK dependency, or production
integration added.

## Proposed fit

Evaluate Jev as an optional intent router after local transcription and speaker
verification. It could choose between a bounded local action, a read-only
context lookup, a clarification, and the current conversational assistant.
This is an architectural proposal, not a measured improvement.

Jev evaluates text/structured state against typed questions. Choice returns an
option with probabilities and confidence; Score returns a rubric score; Noul
returns a yes probability. It does not generate conversational text or process
audio. Keep Sherpa/Whisper, Muse (or a future Hermes adapter), and Piper in their
existing roles. [Introduction](https://docs.typesafe.ai/introduction),
[model reference](https://docs.typesafe.ai/models)

TypeSafe documents the same broad pattern of dispatching requests to code or
an LLM, including a smart-home example. Their Hermes skill-suggestion cookbook
is particularly relevant if HerThing later adopts Hermes: it ranks skills, then
checks a shortlist, while leaving the agent in control. Its published results
are vendor experiments on a different workload, not HerThing measurements.
[Intent routing](https://docs.typesafe.ai/patterns/intent-routing),
[smart-home demo](https://docs.typesafe.ai/demos/smart-home),
[Hermes skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion)

## Practical limits

The documented route is the hosted `POST https://api.typesafe.ai/v1/systemone`
endpoint with a bearer API key. No local/offline deployment option was found in
the reviewed docs. This would introduce a cloud decision step, not move more
processing onto the Ryzen/RX 580. The current model is `jev-1.13.0`; pin it for
evaluations rather than using a moving alias. Published input pricing is
$0.042 per million tokens, with free output tokens. Actual request size and
round-trip latency need measurement. [API](https://docs.typesafe.ai/api),
[models](https://docs.typesafe.ai/models)

TypeSafe reports 70–500 ms end-to-end calls in its launch post, and explains that
its evaluations generally ran from West Coast laptops. This is a vendor claim,
not a guarantee or a benchmark on this PC.
[Launch discussion](https://typesafe.ai/blog/introducing-system-one-models-and-jev)

Schema-conforming output does not imply a correct action. TypeSafe documents
literal interpretation, numeric/date reasoning weaknesses, sensitivity to
adversarial input, and irrelevant-context degradation. Its confidence is derived
from the output distribution; do not treat a value of 0.9 as proven 90% accuracy
on HerThing requests. Calibrate routing thresholds against held-out examples.
[Known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13),
[confidence](https://docs.typesafe.ai/confidence)

TypeSafe says it does not train on customer requests/responses; enterprise zero
retention is separately offered. Do not assume ordinary API use is local or
zero-retention. The first evaluation should use synthetic utterances already in
this repository, without room audio, private calendar details, notes, or Muse
history. [Data-handling reference](https://docs.typesafe.ai/models),
[legal overview](https://docs.typesafe.ai/legal)

## Smallest useful experiment

1. Reuse `benchmarks/laya/evaluation-cases.json` and its separate tuning/stress
   cases. Add current notes, time, correction, negation, quoted-command,
   multi-intent, unsupported, and ambiguous utterances. Keep a held-out set.
2. Compare existing literal rules, Jev alone, and rules followed by Jev only on
   unresolved requests. An exact local rule needs neither a network call nor
   another model; Jev must improve something measurable beyond that baseline.
3. Use one batched request with a bounded route Choice and separate applicability
   checks. Explicitly include fallback/clarification. Never use question key
   names as a substitute for instructions: the API says keys are not model input.
4. Record incorrect direct actions, useful local-action coverage, fallback rate,
   calibration, p50/p95 latency from this PC, token usage, and timeouts. Evaluate
   loss of connectivity and rate limits as well as successful calls.
5. Start offline. A later opt-in shadow mode may compare decisions without
   executing them. Production promotion requires better accuracy/latency than
   the literal-rule baseline, not merely valid JSON.

Keep microphone mute, wake/dismissal, speaker verification, permissions, numeric
volume bounds, date arithmetic, and raw note text handling local. Jev must never
be required to stop listening. On ambiguity or network failure, preserve the
current route; do not infer authorization from a model's confidence.

To run the API experiment, the owner needs TypeSafe account access and a private
`TYPESAFE_API_KEY` from its dashboard. No key is needed to use HerThing's current
stack. [Getting access](https://docs.typesafe.ai/introduction/quickstart)
