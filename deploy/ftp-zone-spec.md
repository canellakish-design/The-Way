# The Way — FTP, HR Zone & Power Zone Calculation Spec

Engineering spec for Claude Code (or any implementer) describing how "The Way" should calculate and continuously recalculate FTP, Threshold HR, HR zones, and power zones from power-meter data and Tymewear (ventilatory) data. This formalizes the methodology already validated manually on Harry's training data (Aug 2026) into an algorithm an app can run automatically.

---

## 1. Inputs

Per activity (ride), the app needs access to:

- **Power stream** — watts, per-second or per-interval, from the head unit/power meter (Garmin FIT file or equivalent).
- **Heart rate stream** — bpm, same resolution.
- **Tymewear breathing stream** (when worn as a connected sensor during the ride) — respiration rate (breaths/min), tidal volume VT (mL/breath), minute ventilation VE (L/min). Only present on rides where Tymewear was paired; treat as optional per-activity.
- **Tymewear dedicated test results** (episodic, not every ride) — from Tymewear's own ramp-test protocol (starts ~70W, +20W every 3 min, watching for inflection points in VE vs. power). Output: VT1 (power, HR), VT2 (power, HR), VO2max (power, HR). These currently live only in the Tymewear app and must be entered manually until/unless a Tymewear API integration exists — see §7.
- **Wellness data** (Whoop or similar) — daily HRV (rMSSD), resting HR. Used only to flag/deweight confounded rides, not as a direct input to zone math.
- **Activity metadata** — timestamp, duration, sport type (only cycling activities should feed this pipeline).

---

## 2. FTP: three signals, reconciled

The app should compute FTP from up to three independent signals and reconcile them rather than trusting any single one blindly.

### 2a. Dedicated-test-derived FTP (highest confidence, but episodic)

When a Tymewear ramp test is logged:

```
FTP_test = VT2_power × discount_factor
```

- `discount_factor` = 0.925 (midpoint of the validated 0.90–0.95 range). Expose as a configurable constant — Tymewear's 3-minute ramp stages don't allow full fatigue accumulation like a real 60-minute effort, so raw VT2 systematically overestimates sustainable power by ~5–10%.
- Only recompute this signal when a new dedicated test is entered. It does not decay or get recalculated between tests.

### 2b. Power-only eFTP (continuous, from every ride)

Standard rolling best-effort estimate, same approach intervals.icu uses:

```
eFTP = best_normalized_power_for_duration(D) × intensity_factor_adjustment
```

- Use best power sustained for a duration in the 20–60 min range within a rolling lookback window (recommend 90 days, weighted toward more recent efforts).
- If using a 20-min best effort, apply the standard ×0.95 correction; if using a genuine 45–60 min effort, no correction needed.
- Recompute after every ride that contains a qualifying sustained effort. Decay older efforts' influence (e.g. exponential weighting by recency) so eFTP tracks current fitness/fatigue rather than a lifetime peak.

### 2c. Passive ventilatory-threshold-derived FTP (continuous, from breathing data)

For rides where Tymewear breathing data is present:

1. Split the ride into steady-state segments (constant target power for ≥3 min — intervals, tempo/SS/threshold blocks, or steady endurance stretches).
2. **Discard the first 60–90 seconds of every segment** — breathing lags power changes by 20–60+ seconds, so early samples bias the fit.
3. For each remaining segment, compute avg power and avg VE (and optionally avg respiration rate, avg VT).
4. Pool segments across rides within a lookback window (recommend 90 days) into a single (power, VE) point set.
5. Fit a two-segment piecewise-linear regression (changepoint/breakpoint detection) to VE vs. power. The breakpoint with the shallower-to-steeper slope change nearest the aerobic range ≈ VT1; a second, sharper breakpoint at higher power ≈ VT2. (A simple approach: bin power into ~10W buckets, compute the VE/power slope between consecutive bins, and flag the bins where slope jumps by more than ~1.5× the preceding slope as candidate breakpoints. A proper segmented-regression library, e.g. `ruptures` or `pwlf` in Python, will be more robust than the binning heuristic once there's enough data.)
6. `FTP_ventilatory = VT2_power_from_curve × discount_factor` (same 0.925 default as §2a, since this VT2 is also a ramp-like inflection rather than a true 60-min effort).
7. **Minimum data requirement:** don't trust this signal until pooled segments span a power range that actually brackets the expected VT2 (i.e. include steady-state data above ~85% of current FTP). Below that, only report VT1 or flag as "insufficient range to estimate VT2."

**Confound handling:** for each segment, pull that day's HRV/resting HR (if available). Segments from days where HRV is more than ~1.5 SD below the trailing 30-day baseline, or resting HR is more than ~1.5 SD above it, should be flagged and either excluded from the curve fit or down-weighted — ventilation at a given power is meaningfully elevated on fatigued/illness days (confirmed: ~26% higher VE at matched power on a low-HRV day vs. a normal day) and will bias the inflection estimate if pooled in unweighted.

### 2d. Reconciliation

Priority order when signals disagree:

1. If a dedicated test exists within the last ~60 days, treat `FTP_test` as authoritative for the app's displayed FTP.
2. Use `FTP_ventilatory` and `eFTP` as continuous cross-checks, displayed alongside but not overwriting the test-derived value automatically.
3. If `FTP_ventilatory` and `eFTP` agree with each other but diverge from `FTP_test` by more than ~5%, surface a "your fitness has likely shifted since your last test — consider retesting" prompt rather than silently changing FTP.
4. If no dedicated test has ever been entered, fall back to `eFTP` as the primary signal (it needs no special equipment) and show `FTP_ventilatory` as a secondary cross-check once enough data exists.

---

## 3. Threshold HR

```
Threshold_HR = VT2_HR   (from whichever signal produced the accepted FTP above)
```

No discount factor for HR — unlike power, the heart rate at VT2 doesn't need correction for the ramp protocol's shortened stages. Recompute Threshold HR at the same time as FTP (i.e., driven by the same accepted signal from §2d), not on a separate schedule.

---

## 4. Power zones (7-zone Coggan model)

Recalculate automatically whenever accepted FTP changes:

| Zone | % FTP | Name |
|------|-------|------|
| Z1 | 0–55% | Active Recovery |
| Z2 | 55–75% | Endurance |
| Z3 | 76–90% | Tempo |
| Z4 | 91–105% | Threshold |
| Z5 | 106–120% | VO2max |
| Z6 | 121–150% | Anaerobic Capacity |
| Z7 | 150%+ | Neuromuscular |

(These are the standard breakpoints — 55/75/90/105/120/150% — already used to validate that Garmin and intervals.icu zones matched during the Aug 2026 calibration.)

---

## 5. HR zones (calculate from %LT, never %Max)

Base HR zones on **Threshold HR (§3)**, not on a Max HR field — max HR is frequently a bad auto-estimate (device default) rather than a measured value, and anchoring to it silently distorts every zone below it. Use the 7-zone %LT model:

| Zone | % Threshold HR | Name |
|------|------|------|
| Z1 | <80% | Recovery |
| Z2 | 80–89% | Aerobic |
| Z3 | 89–95% | Tempo |
| Z4 | 95–100% | SubThreshold |
| Z5 | 100–103% | SuperThreshold |
| Z6 | 103–106% | Aerobic Capacity |
| Z7 | 106%+ | Anaerobic |

(Percentages above are approximate — derive exact breakpoints the same way intervals.icu does off a single Threshold HR input, rather than hardcoding absolute bpm values, so zones auto-recalculate whenever Threshold HR changes.)

If the app also wants to track a true Max HR (useful for capping display ranges, not for zone math), only populate it from an actual observed all-out effort — never from a device default.

---

## 6. Recalculation triggers

The app should recompute in these cases:

- **New dedicated Tymewear test logged** → recompute FTP, Threshold HR, both zone sets immediately.
- **New ride with a qualifying sustained effort** (≥20 min at reasonably steady power) → recompute `eFTP`.
- **New ride with Tymewear breathing data and steady-state segments** → append to the pooled dataset and recompute `FTP_ventilatory` (can be batched, e.g. nightly, rather than per-ride).
- **Manual override** → allow the user to pin FTP/Threshold HR directly (e.g. after a real-world race-pace effort that isn't a formal "test" in the app's data model); manual values should behave like §2a (authoritative until superseded) until the user clears the override.

Every recalculation should log which signal(s) drove the new value and by how much it changed, so the user can audit "why did my FTP change" rather than just seeing a new number appear.

---

## 7. Known gaps to design around

- **Tymewear dedicated test results have no API today** — they live only in the Tymewear app. Until that changes, §2a inputs need either manual entry in The Way, or a scraping/export workaround. Don't assume automatic ingestion is available at launch.
- **Breathing data from live-sensor rides does flow into standard FIT files** (respiration rate, VT, VE), so §2c's per-ride data should be readable from any FIT-file-ingesting pipeline (Garmin Connect export, direct ANT+/BLE capture, etc.) without needing Tymewear's own API.
- **Minimum viable version:** if building incrementally, ship §2b (power-only eFTP) and §4/§5 zone math first — that needs only a power meter and HR strap, no Tymewear at all. Layer in §2c (ventilatory cross-check) once there's a reliable way to pull breathing streams, and §2a (dedicated test ingestion) once Tymewear data entry/import is built.
