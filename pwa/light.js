// light.js: how much light a ride has, minute by minute (Harry, 9 Nov 2026: "don't just do sunset, think about light").
// One file for both sides: the page loads it as window.Light, the bridge requires it (bridge/light.js).
//
// Every minute of a ride is one of four:
//   day       full light
//   low       the half hour of low sun after sunrise and before sunset: glare in drivers' eyes on the road,
//             flat light that hides roots and rocks on a trail
//   twilight  civil twilight, the sun up to 6 degrees down: you can still see, but you need lights to be seen
//   dark      after civil dusk, before civil dawn
// Under trees (a mountain bike ride) everything comes half an hour sooner in the evening and later in the
// morning: the woods are in twilight for the half hour before sunset and dark from sunset.
(function (root) {
  const LOW_MIN = 30, WOODS_MIN = 30;
  // points off the hour's 100, per minute ridden in each kind of light: an hour of full dark is the whole 100
  const PEN = { day: 0, low: 0.3, twilight: 1.2, dark: 100 / 60 };
  const MTB_RE = /mountain bike|\bmtb\b|trail ride|singletrack/i;

  const hm = s => { const m = /(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  const clock = min => { const t = ((Math.round(min) % 1440) + 1440) % 1440, h = Math.floor(t / 60), m = t % 60;
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`; };

  // Civil twilight's length that day at that latitude: the sun going from just set (zenith 90.833) to 6 down (96).
  function twilightMinutes(dateKey, lat) {
    const [y, mo, d] = String(dateKey).split('-').map(Number);
    const N = Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 0)) / 864e5);
    const g = 2 * Math.PI / 365 * (N - 1 + 0.5), rad = Math.PI / 180;
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const ha = z => { const c = Math.cos(z * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl); return Math.acos(Math.max(-1, Math.min(1, c))) / rad; };
    return Math.round((ha(96) - ha(90.833)) * 4);
  }

  // The day's light from its sunrise and sunset ("06:42", "16:57", local) and the latitude.
  function lightDay(dateKey, lat, sunrise, sunset) {
    const sr = typeof sunrise === 'number' ? sunrise : hm(sunrise), ss = typeof sunset === 'number' ? sunset : hm(sunset);
    if (sr == null || ss == null) return null;
    const t = twilightMinutes(dateKey, lat);
    return { dawn: sr - t, sunrise: sr, sunset: ss, dusk: ss + t, twilight_min: t };
  }

  function levelAt(min, L, woods) {
    const w = woods ? WOODS_MIN : 0;
    const dawn = woods ? L.sunrise : L.dawn, dusk = woods ? L.sunset : L.dusk;
    const sr = L.sunrise + w, ss = L.sunset - w;
    if (min < dawn || min >= dusk) return 'dark';
    if (min < sr || min >= ss) return 'twilight';
    if (min < sr + LOW_MIN || min >= ss - LOW_MIN) return 'low';
    return 'day';
  }

  // The light over [from, to) in minutes of the day: the minutes of each kind, the points off, and why.
  function lightCut(from, to, L, woods) {
    const n = { day: 0, low: 0, twilight: 0, dark: 0 };
    if (L) for (let m = Math.round(from); m < Math.round(to); m++) n[levelAt(m, L, woods)]++;
    const cut = n.low * PEN.low + n.twilight * PEN.twilight + n.dark * PEN.dark;
    const where = woods ? ' under the trees' : '';
    // the reasons, the one that cost the most points first
    const why = [
      [n.dark * PEN.dark, n.dark ? `dark${where} ${n.dark} min` : null],
      [n.twilight * PEN.twilight, n.twilight ? `half light${where} ${n.twilight} min${woods ? '' : ', lights on'}` : null],
      [n.low * PEN.low, n.low >= 10 ? (woods ? `flat light in the woods ${n.low} min` : `low sun, glare ${n.low} min`) : null],
    ].filter(x => x[1]).sort((p, q) => q[0] - p[0]).map(x => x[1]);
    return { cut, minutes: n, why };
  }

  // The plain-words light for a ride: when good light ends, when lights go on, when it is dark.
  function summary(L, woods) {
    if (!L) return null;
    const w = woods ? WOODS_MIN : 0;
    const goodTo = L.sunset - w - LOW_MIN, lightsAt = L.sunset - w, darkAt = woods ? L.sunset : L.dusk;
    return { good_until: clock(goodTo), lights_from: clock(lightsAt), dark_at: clock(darkAt), woods: !!woods,
      words: woods ? `good light under the trees to ${clock(goodTo)}, dim from ${clock(lightsAt)}, dark on the trail by ${clock(darkAt)}`
                   : `good light to ${clock(goodTo)}, lights on from ${clock(lightsAt)}, dark at ${clock(darkAt)}`,
      minutes: { good_until: goodTo, lights_from: lightsAt, dark_at: darkAt } };
  }

  const isWoods = (name, sport) => MTB_RE.test(String(name || '')) || /mountain/i.test(String(sport || ''));

  const api = { PEN, LOW_MIN, WOODS_MIN, twilightMinutes, lightDay, levelAt, lightCut, summary, isWoods, clock, hm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Light = api;
})(typeof window !== 'undefined' ? window : this);
