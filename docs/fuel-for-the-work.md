# Fuel for the work required (3 Nov 2026)

Carbohydrate periodised by the session, not the day's name (Impey et al. 2018, *Sports Medicine*). Each session gets a prescription from what it demands; the day's carbs are the sum of the work.

## The prescription (bridge/food-math.js, `sessionRx` / `fuelRx`)

| Kind | When | Before | On the bike | Within 2 h after |
|---|---|---|---|---|
| **low** | a Zone 1 ride under 90 min, morning; one a week; never on a hard day or the day before one | coffee + a Huel plant protein shake, under 20 g carbs | water | 45 g protein, ~0.4 g/kg carbs |
| **light** | a Zone 1 ride under 2 h | 25 g+ carbs with 30 g protein, 1–2 h before | 30 g/h past 75 min | 45 g protein, ~40–55 g carbs |
| **long** | 2 h and up | ~1 g/kg carbs, 2–3 h before | 60 g/h (90 past 2.5 h) | 45 g protein, up to 1.2 g/kg carbs; starch at dinner |
| **hard** | VO2, threshold, a race | carbs 2–3 h before | the 50 g bottle | 45 g protein, carbs: recover high |
| **lift** | | 30 g protein | | 40 g protein; carbs follow the riding |

The grams before and after come from the ride's work: 0.15 g per kJ (a fifth more when hard), 45% before and 75% after, each inside the g/kg bands. An early ride's bite before it holds 30 g at most; the rest lands after.

## The day
- Carbs = **1.5 g/kg** (the floor) + each session's before + bottle + after, capped at 6 g/kg. Protein stays 1.9 g/kg. Fat takes what is left of the calories down to its floor; past that the deficit gives ("hard days eat to the work").
- Labels: rest day · train-low day · moderate carb day · higher carb day.
- **Sleep low** is marked when a train-low morning follows an evening session.
- The train-low rule runs across the week in order from Monday (bridge/fuel-week.js): `TRAIN_LOW_PER_WEEK = 1`.

## Where it shows
- **Food, Day:** the day's label and targets; the meal plan's before / bottle / after slots carry the prescription and are fixed; the other meals share the rest.
- **Calendar:** every day a week ahead: grams, g/kg, the label, and each ride's windows ("25 g before · water · 39 g after").
- **Fuel:** each ride's parts: before (a low before is kept low: at or under is the point), the bottle, after (judged once the two hours have passed), supplements.
- **Coach:** the debrief judges fuelling against the session's `rx` in `/food/today`.
- **Player:** the fuel slots come from the same meal plan.

## Sources
Impey 2018 (fuel for the work required); Burke 2011 (g/kg bands); Marquet 2016 (sleep low, three weeks, hard work fuelled); Jeukendrup 2014 (on the bike by duration); Aragon & Schoenfeld 2013 (the two-hour window); Hector & Phillips 2018 (protein in a deficit, masters).
