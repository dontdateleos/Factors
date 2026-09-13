# The engine, pinned

This directory exists so the scoring and planning engine can be rebuilt in another language
without anybody re-deriving it by reading 17,700 lines of JavaScript and hoping.

Everything here is **generated from the running app**, never typed by hand:

```
node tools/spec-dump.mjs      # with the app served on :8899
```

| file | what it is |
|---|---|
| `constants.json` | 315 engine parameters, **evaluated** — so `SIG_ALPHA` is `0.1331`, not `1 - Math.exp(-1/SIG_TAU)` |
| `libraries.json` | 13 content libraries — exercises, mobility, warm-ups, progressions, templates |
| `golden.json` | inputs → outputs for the pure scoring functions |
| `scenarios.json` | the 22 behavioural scenarios and their current verdicts |

**A port is conformant when it reproduces `golden.json` exactly and passes the same 22
scenarios.** Those are the two things to build first in any new language, before any UI.

---

## The score cascade

There is not one score. There are four, and they are tried in strict order — the first one
that is available wins and the rest are not consulted. This precedence is in
`updateOverallScore()`.

**1. Systemic Readiness (SR)** — the headline when it has earned it.
Nine weighted channels, each a z-score, summed and squashed:

```
score = clamp(round(50 + 50 * tanh(SR_TANH_K * Σ wᵢ·zᵢ)), 0, 100)
```

`SR_TANH_K = 0.8`. Weights sum to 1.000 and are in `constants.json → SR_WEIGHTS`:
subjective .180, hrvTrend .180, rhr .140, sleep .120, load .100, hrvAcute .080,
sleepDebt .080, illnessCh .070, regularity .050. `hrvAcute` is damped by
`SR_HRV_ACUTE_DAMP = 0.5` first.

Two gates refuse to composite rather than show a thin number:
`SR_MIN_COMPLETENESS = 0.40` (fraction of weight present) and `SR_MIN_MATURITY = 0.30`.

On a blinded day SR reports `held` and the number is computed and deliberately not shown.

**2. Capacity** — the fallback once 7+ paired days exist. Correlation-weighted: Pearson r of
each predictor against observed capacity, applied to today's z-scores.

**3. Target / Adaptive average** — the cold-start path, and the only fully pure function.

**4. Nothing** — no inputs, no number.

### Target and Adaptive, exactly

`scoresForEntry(entry, trailing)`. Source precedence matters and is not symmetric:
**HRV takes Garmin over Oura; wake time takes Oura over Garmin.**

Target — each present part clamped to 0–100, then the mean, rounded:

```
duration : duration / 8 * 100
wakeTime : 100 - wakeTime * WAKE_TIME_PENALTY      (1.5 per minute awake)
hrv      : hrv / hrvBaseline * 100                  (only if a baseline exists)
```

Adaptive — the same three, but each measured against *your* trailing average instead of the
fixed constant, and **only when that average has at least `MIN_TRAILING_N = 3` observations**.
Below three it silently falls back to the Target formula for that part. `golden.json` pins
this at the boundary: n=2 gives 85, n=3 gives 93, on identical input.

---

## The signal layer

Everything above consumes z-scores produced by one shared pipeline (`SIG_*`):

- EWMA with `SIG_TAU = 7` days → `SIG_ALPHA = 0.1331`
- baseline mean and sd over `SIG_BASE_DAYS = 60`
- `SIG_MATURITY_N = 40` effective observations before a baseline is called mature
- z winsorised at `SIG_CLAMP = 3`, both directions
- `SCORE_ALGO_VERSION = 2` is stamped onto every entry

## Learning

Weights move with your data (`LEARN_*`): untouched below `LEARN_MIN_SESSIONS = 12`, full
movement at `LEARN_FULL_AT = 60`, and **no weight can ever move more than
`LEARN_MAX_SHIFT = 0.6` from its prior**. Unblinded days count at
`LEARN_UNBLINDED_WEIGHT = 0.25`.

---

## What is captured but not yet written up

The constants for these are all in `constants.json`; the prose is not written and a port
should not start on them from this document alone:

- **Tissue Readiness (TR)** — per muscle group. `TR_HALFLIFE_H` general 36h / eccentric 60h /
  connective 120h, `TR_ECCENTRIC_MULT` 2.5, `TR_NOVELTY_K` 0.35 (repeated-bout effect),
  `TR_MIN_LOADED_DAYS` 5.
- **Circadian Readiness (CR)** — `CR_WEIGHTS`, `CR_ALCOHOL_PENALTY`, peak hours.
- **Load** — `LOAD_TAU_ACUTE` 7 / `LOAD_TAU_CHRONIC` 42, `LOAD_FLAG_PCTL` 0.90.
- **Illness** — CUSUM at `CUSUM_K` 0.5 / `CUSUM_H` 4, two channels minimum, two days persistent.
- **The generator** — splits, emphasis blocks, conflict scoring, progression, injury safety.
  The 22 scenarios cover its behaviour; the mechanism is not described here.

## Known gaps

- `INJURY_PROTOCOLS` and `TENDINOPATHY_PROTOCOL` are declared but not reachable from the page
  scope the dump evaluates in, so they are **not** in `libraries.json`. They have to be moved
  or extracted another way before a port can use them.
- `golden.json` covers the pure functions only. The SR, CR, TR and capacity layers all read
  storage, so pinning them needs a fixture of stored days — that is the next piece of work
  and the one that matters most.
