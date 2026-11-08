// The Way's data screen. Put it on a one-field page of the ride profile and it does two things:
//   1. records the ride into the site: one sample a second of timer time (power, heart rate, cadence,
//      speed), sent in batches every 30 seconds over the phone to POST /garmin/ride, where it lands in
//      the player's store and counts on the Day, the chain and the calendar like any ride (no Strava);
//   2. shows the ride against the plan: the numbers now, the day's session and its current step's target,
//      the minutes above the VT2 line, and whether the site has the ride so far.
// The Edge still records its own file as always; the site only takes the live copy.
import Toybox.Activity;
import Toybox.Application;
import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

class TheWayField extends WatchUi.DataField {
    private const BATCH_S = 30;          // seconds of samples per request
    private const KEEP_MAX = 1800;       // unsent seconds kept while the phone is away (the Edge's own file has the rest)
    private const RETRY_S = 15;          // after a failed send
    // the buckets: the same lines as the heart colours (VT1 117 bpm, VT2 the session's, 139 by default)
    private const VT1_W = 169;           // low below this, by power
    private const VT2_W = 208;           // peak from this, by power
    private const VT1_HR = 117;          // low below this, by heart rate when there is no power
    // colour means the bucket and nothing else; blue / amber / red stay apart for red-green colour blindness
    // and also step light to dark, so they read even in grey
    private const C_LOW = 0x0099FF;
    private const C_HIGH = 0xFFAA00;
    private const C_PEAK = 0xE00000;
    // decoupling: green under 5 %, yellow 5 to 10 %, red over 10 % (Harry asked for these, 8 Nov)
    private const C_DEC_GREEN = 0x22BB44;
    private const C_DEC_YELLOW = 0xFFDD00;
    private const C_DEC_RED = 0xE00000;
    // what the field uses: the built-in values above until the bridge sends its own at ride start
    private var _vt1W as Number = VT1_W;
    private var _vt2W as Number = VT2_W;
    private var _vt1Hr as Number = VT1_HR;
    private var _colLow as Number = C_LOW;
    private var _colHigh as Number = C_HIGH;
    private var _colPeak as Number = C_PEAK;
    // the plan per bucket, when the bridge sends buckets_plan (then the field never works it out from steps)
    private var _planFromBridge as Boolean = false;
    private var _hasPlan as Boolean = false;
    private var _planLow as Number = 0;
    private var _planHigh as Number = 0;
    private var _planPeak as Number = 0;

    // the ride
    private var _rideId as Number = 0;             // start, seconds since the epoch (the site's id is this × 1000)
    private var _t as Array<Number> = [];          // timer seconds
    private var _p as Array<Number or Null> = [];
    private var _h as Array<Number or Null> = [];
    private var _c as Array<Number or Null> = [];
    private var _s as Array<Float or Null> = [];
    private var _lastT as Number = -1;
    private var _inflight as Number = 0;           // samples in the request on its way (taken off the front of the arrays)
    private var _inflightT as Array<Number> = [];
    private var _inflightP as Array<Number or Null> = [];
    private var _inflightH as Array<Number or Null> = [];
    private var _inflightC as Array<Number or Null> = [];
    private var _inflightS as Array<Float or Null> = [];
    private var _sending as Boolean = false;
    private var _done as Boolean = false;
    private var _sentSeconds as Number = 0;
    private var _lastOkAt as Number = 0;           // epoch seconds of the last answer from the site
    private var _lastCode as Number = 0;
    private var _nextSendAt as Number = 0;         // timer seconds

    // the plan
    private var _sessionName as String or Null = null;
    private var _workoutId as String or Null = null;
    private var _vt2 as Number = 139;
    private var _steps as Array = [];              // [start_s, dur_s, target_w, hr_lo, hr_hi] each
    private var _sessionAsked as Boolean = false;

    // now, for the screen
    private var _power as Number or Null = null;
    private var _hr as Number or Null = null;
    private var _cad as Number or Null = null;
    private var _timerS as Number = 0;
    private var _aboveS as Number = 0;             // seconds at or above the VT2 line
    private var _lowS as Number = 0;               // seconds in each bucket: low (below VT1),
    private var _highS as Number = 0;              //   high (VT1 to VT2),
    private var _peakS as Number = 0;              //   peak (VT2 and up)
    private var _plannedS as Number = 0;           // seconds the plan named a bucket for
    private var _onPlanS as Number = 0;            //   ...and of those, seconds ridden in that bucket
    private var _minP as Array<Number> = [];       // per ride-minute sums for decoupling: power,
    private var _minH as Array<Number> = [];       //   heart rate,
    private var _minN as Array<Number> = [];       //   and samples with both
    private var _nextAt as Number = 0;             // next calendar event, epoch seconds (from the site)
    private var _nextTitle as String or Null = null;
    private var _running as Boolean = false;

    public function initialize() {
        DataField.initialize();
    }

    private function bridge() as String {
        var v = Application.Properties.getValue("bridge");
        var s = (v instanceof String) ? v : "https://thewayforward.netlify.app";
        if (s.length() > 0 && s.substring(s.length() - 1, s.length()).equals("/")) { s = s.substring(0, s.length() - 1); }
        return s + "/.netlify/functions/api";
    }

    // ---- the plan: asked once, when the ride starts ----
    private function askSession() as Void {
        if (_sessionAsked) { return; }
        _sessionAsked = true;
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => { "x-the-way-app" => "1" },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        Communications.makeWebRequest(bridge() + "/garmin/session/today", null, options, method(:onSession));
    }

    public function onSession(code as Number, data as Dictionary or String or Null) as Void {
        if (code != 200 || !(data instanceof Dictionary)) { return; }
        var name = data.get("name");
        if (name instanceof String) { _sessionName = name; }
        var wid = data.get("workout_id");
        if (wid instanceof String) { _workoutId = wid; }
        var vt2 = data.get("vt2_hr");
        if (vt2 instanceof Number) { _vt2 = vt2; }
        var steps = data.get("steps");
        if (steps instanceof Array) { _steps = steps; }
        var lines = data.get("lines");
        if (lines instanceof Dictionary) {
            var v;
            v = lines.get("vt1_w");  if (v instanceof Number) { _vt1W = v; }
            v = lines.get("vt2_w");  if (v instanceof Number) { _vt2W = v; }
            v = lines.get("vt1_hr"); if (v instanceof Number) { _vt1Hr = v; }
            v = lines.get("vt2_hr"); if (v instanceof Number) { _vt2 = v; }
        }
        var colours = data.get("colours");
        if (colours instanceof Dictionary) {
            var c;
            c = hexColour(colours.get("low"));  if (c != null) { _colLow = c; }
            c = hexColour(colours.get("high")); if (c != null) { _colHigh = c; }
            c = hexColour(colours.get("peak")); if (c != null) { _colPeak = c; }
        }
        if (data.hasKey("buckets_plan")) {
            var bp = data.get("buckets_plan");
            if (bp instanceof Dictionary) {
                var lo = bp.get("low"); var hi = bp.get("high"); var pk = bp.get("peak");
                _planLow = (lo instanceof Number) ? lo : 0;
                _planHigh = (hi instanceof Number) ? hi : 0;
                _planPeak = (pk instanceof Number) ? pk : 0;
                _hasPlan = (_planLow + _planHigh + _planPeak) > 0;
            } else {
                _hasPlan = false;                          // no plan: bars share ride time, no totals, no due line
            }
            _planFromBridge = true;                        // never recompute the plan from steps
        }
        var nx = data.get("next_event");                 // { "start": epoch seconds, "title": "..." }
        if (nx instanceof Dictionary) {
            var at = nx.get("start");
            if (at instanceof Number) { _nextAt = at; }
            var ti = nx.get("title");
            if (ti instanceof String) { _nextTitle = ti; }
        }
    }

    // ---- recording ----
    public function compute(info as Activity.Info) as Void {
        _power = info.currentPower;
        _hr = info.currentHeartRate;
        _cad = info.currentCadence;
        var running = (info.timerState != null) && (info.timerState == Activity.TIMER_STATE_ON);
        _running = running;
        var tt = info.timerTime;
        if (tt == null) { return; }
        _timerS = tt / 1000;
        if (!running) { return; }
        if (_rideId == 0) { startRide(); }
        var t = _timerS;
        if (t <= _lastT) { return; }
        _lastT = t;
        if (_hr != null && _hr >= _vt2) { _aboveS++; }
        var z = zoneOf(_power, _hr);
        if (z == 0) { _lowS++; } else if (z == 1) { _highS++; } else if (z == 2) { _peakS++; }
        var st = stepNow();
        if (st != null) {
            var pz = stepZone(st);
            if (pz >= 0) { _plannedS++; if (z == pz) { _onPlanS++; } }
        }
        if (_power != null && _hr != null && _hr > 0) {
            var mi = t / 60;
            while (_minN.size() <= mi) { _minP.add(0); _minH.add(0); _minN.add(0); }
            _minP[mi] = _minP[mi] + _power; _minH[mi] = _minH[mi] + _hr; _minN[mi] = _minN[mi] + 1;
        }
        _t.add(t); _p.add(_power); _h.add(_hr); _c.add(_cad);
        var sp = info.currentSpeed;
        _s.add(sp == null ? null : sp * 3.6);
        while (_t.size() > KEEP_MAX) { _t = _t.slice(1, null); _p = _p.slice(1, null); _h = _h.slice(1, null); _c = _c.slice(1, null); _s = _s.slice(1, null); }
        if (t >= _nextSendAt) { send(false); }
    }

    private function startRide() as Void {
        _rideId = Time.now().value();
        _t = []; _p = []; _h = []; _c = []; _s = [];
        _lastT = -1; _aboveS = 0; _lowS = 0; _highS = 0; _peakS = 0; _sentSeconds = 0;
        _plannedS = 0; _onPlanS = 0; _minP = []; _minH = []; _minN = [];
        _done = false; _nextSendAt = BATCH_S;
        askSession();
    }

    public function onTimerStart() as Void {
        if (_rideId == 0) { startRide(); }
    }

    public function onTimerStop() as Void {
        send(false);
    }

    public function onTimerReset() as Void {
        // the activity has ended (saved or discarded): the last seconds go, marked done
        _done = true;
        send(true);
        _rideId = 0;
        _sessionAsked = false;
    }

    private function send(force as Boolean) as Void {
        if (_rideId == 0 || _sending) { return; }
        if (_t.size() == 0 && !force) { return; }
        _inflightT = _t; _inflightP = _p; _inflightH = _h; _inflightC = _c; _inflightS = _s;
        _inflight = _t.size();
        _t = []; _p = []; _h = []; _c = []; _s = [];
        var params = {
            "id" => _rideId,
            "device" => "edge",
            "t" => _inflightT, "p" => _inflightP, "h" => _inflightH, "c" => _inflightC, "s" => _inflightS,
            "done" => _done
        };
        if (_sessionName != null) { params.put("name", _sessionName); }
        if (_workoutId != null) { params.put("workout_id", _workoutId); }
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON, "x-the-way-app" => "1" },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        _sending = true;
        _nextSendAt = _timerS + BATCH_S;
        Communications.makeWebRequest(bridge() + "/garmin/ride", params, options, method(:onSent));
    }

    public function onSent(code as Number, data as Dictionary or String or Null) as Void {
        _sending = false;
        _lastCode = code;
        if (code == 200) {
            _sentSeconds += _inflight;
            _lastOkAt = Time.now().value();
        } else {
            // not taken: the batch goes back in front of what has gathered since, sent again soon
            _t = _inflightT.addAll(_t); _p = _inflightP.addAll(_p); _h = _inflightH.addAll(_h); _c = _inflightC.addAll(_c); _s = _inflightS.addAll(_s);
            _nextSendAt = _timerS + RETRY_S;
        }
        _inflight = 0;
        _inflightT = []; _inflightP = []; _inflightH = []; _inflightC = []; _inflightS = [];
    }

    // ---- the plan's step now ----
    private function stepNow() as Array or Null {
        for (var i = 0; i < _steps.size(); i++) {
            var st = _steps[i] as Array;
            if (st.size() < 5) { continue; }
            var start = st[0] as Number; var dur = st[1] as Number;
            if (_timerS >= start && _timerS < start + dur) { return st; }
        }
        return null;
    }

    // ---- the buckets ----
    // 0 low, 1 high, 2 peak; power decides when there is a power reading (0 W coasting is low), else heart rate
    private function zoneOf(w as Number or Null, hr as Number or Null) as Number {
        if (w != null) {
            if (w >= _vt2W) { return 2; }
            if (w >= _vt1W) { return 1; }
            return 0;
        }
        if (hr != null) {
            if (hr >= _vt2) { return 2; }
            if (hr >= _vt1Hr) { return 1; }
            return 0;
        }
        return -1;
    }

    // the bucket a planned step fills: by its watts, else the middle of its heart-rate band; a free step fills none
    private function stepZone(st as Array) as Number {
        var tw = st[2] as Number; var lo = st[3] as Number; var hi = st[4] as Number;
        if (tw > 0) { return zoneOf(tw, null); }
        if (hi > 0) { return zoneOf(null, (lo + hi) / 2); }
        return -1;
    }

    // planned seconds per bucket: the whole session (upTo < 0) or only what the plan has reached by upTo
    private function planned(upTo as Number) as Array<Number> {
        var out = [0, 0, 0] as Array<Number>;
        for (var i = 0; i < _steps.size(); i++) {
            var st = _steps[i] as Array;
            if (st.size() < 5) { continue; }
            var z = stepZone(st);
            if (z < 0) { continue; }
            var start = st[0] as Number; var dur = st[1] as Number;
            var d = dur;
            if (upTo >= 0) {
                d = upTo - start;
                if (d > dur) { d = dur; }
                if (d < 0) { d = 0; }
            }
            out[z] = out[z] + d;
        }
        return out;
    }

    // three bars like Xert's buckets: each fills with the time ridden in it, out of what the session plans for it;
    // the white line is where the plan says the bucket should be by now. Without a plan they share the ride time.
    private function drawBuckets(dc as Dc, top as Number, bot as Number, w as Number, fg as Number, dim as Number) as Void {
        var done = [_lowS, _highS, _peakS] as Array<Number>;
        var plan = planned(-1);
        var due = planned(_timerS);
        if (_planFromBridge) {
            if (_hasPlan) { plan = [_planLow, _planHigh, _planPeak] as Array<Number>; }
            else { plan = [0, 0, 0] as Array<Number>; due = [0, 0, 0] as Array<Number>; }   // no plan: no totals, no due line
        }
        var names = ["LOW", "HIGH", "PEAK"] as Array<String>;
        var cols = [_colLow, _colHigh, _colPeak] as Array<Number>;
        var ink = [Graphics.COLOR_BLACK, Graphics.COLOR_BLACK, Graphics.COLOR_WHITE] as Array<Number>;
        var cur = _running ? zoneOf(_power, _hr) : -1;     // the bucket being ridden in now is lit
        var planAll = plan[0] + plan[1] + plan[2];
        var bw = w / 5;
        var gap = (w - 3 * bw) / 4;
        var hBar = bot - top;
        var xh = dc.getFontHeight(Graphics.FONT_XTINY);
        for (var i = 0; i < 3; i++) {
            var x = gap + i * (bw + gap);
            var cx = x + bw / 2;
            var full = plan[i];
            if (full <= 0) { full = (planAll > _timerS) ? planAll : _timerS; }
            if (full <= 0) { full = 1; }
            if (i == cur) {
                dc.setColor(cols[i], Graphics.COLOR_TRANSPARENT);
                dc.fillRoundedRectangle(x - 4, top - xh - 8, bw + 8, xh + 6, 4);
                dc.setColor(ink[i], Graphics.COLOR_TRANSPARENT);
            } else {
                dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
            }
            dc.drawText(cx, top - xh - 4, Graphics.FONT_XTINY, names[i], Graphics.TEXT_JUSTIFY_CENTER);
            var f = done[i] * hBar / full;
            if (f > hBar) { f = hBar; }
            if (f > 0) {
                dc.setColor(cols[i], Graphics.COLOR_TRANSPARENT);
                dc.fillRectangle(x, bot - f, bw, f);
            }
            if (i == cur) {
                dc.setColor(cols[i], Graphics.COLOR_TRANSPARENT);
                dc.setPenWidth(8);
                dc.drawRectangle(x - 4, top - 2, bw + 8, hBar + 4);
            } else {
                dc.setColor(dim, Graphics.COLOR_TRANSPARENT);
                dc.setPenWidth(3);
                dc.drawRectangle(x, top, bw, hBar);
            }
            if (planAll > 0 && plan[i] > 0) {
                var dy = bot - due[i] * hBar / plan[i];
                dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
                dc.setPenWidth(4);
                dc.drawLine(x - 8, dy, x + bw + 8, dy);
            }
            dc.setPenWidth(1);
            dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
            // the big number is what is left to ride in the bucket; past the plan it shows the overshoot
            var big = mmss(done[i]);
            var sub = "";
            if (planAll > 0 && plan[i] > 0) {
                var left = plan[i] - done[i];
                if (left >= 0) { big = mmss(left); sub = "left of " + mmss(plan[i]); }
                else { big = "+" + mmss(-left); sub = "over " + mmss(plan[i]); }
            } else if (planAll > 0) {
                sub = "none planned";
            }
            dc.drawText(cx, bot + 4, Graphics.FONT_SMALL, big, Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(dim, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, bot + 4 + dc.getFontHeight(Graphics.FONT_SMALL), Graphics.FONT_XTINY, sub, Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    // Pa:HR decoupling so far: power per beat in the first half against the second, in %.
    // The first 10 minutes are warm-up and left out (heart rate is still catching up); shown from 20 minutes.
    private const DEC_SKIP_MIN = 10;
    private function decoupling() as Float or Null {
        var n = _minN.size();
        if (_timerS < 1200 || n < DEC_SKIP_MIN + 10) { return null; }
        var half = DEC_SKIP_MIN + (n - DEC_SKIP_MIN) / 2;
        var p1 = 0; var h1 = 0; var p2 = 0; var h2 = 0;
        for (var i = DEC_SKIP_MIN; i < n; i++) {
            if (i < half) { p1 += _minP[i]; h1 += _minH[i]; } else { p2 += _minP[i]; h2 += _minH[i]; }
        }
        if (h1 <= 0 || h2 <= 0 || p1 <= 0) { return null; }
        var ef1 = p1.toFloat() / h1; var ef2 = p2.toFloat() / h2;
        return (ef1 - ef2) / ef1 * 100.0;
    }

    private function fitFont(dc as Dc, s as String, maxW as Number, maxH as Number) as Graphics.FontDefinition {
        var fonts = [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_MILD,
                     Graphics.FONT_LARGE, Graphics.FONT_MEDIUM] as Array<Graphics.FontDefinition>;
        for (var i = 0; i < fonts.size(); i++) {
            if (dc.getTextWidthInPixels(s, fonts[i]) <= maxW && dc.getFontHeight(fonts[i]) <= maxH) { return fonts[i]; }
        }
        return Graphics.FONT_SMALL;
    }

    // one cell of the bottom half: a small grey label, the value in ink as big as fits, and an optional bucket bar
    private function tile(dc as Dc, x as Number, y as Number, tw as Number, th as Number, label as String,
                          value as String, fg as Number, dim as Number, bar as Number) as Void {
        tileOn(dc, x, y, tw, th, label, value, fg, dim, bar, -1);
    }

    // the same cell on a coloured background (bgc -1: none); on a fill the ink is black, white on red
    private function tileOn(dc as Dc, x as Number, y as Number, tw as Number, th as Number, label as String,
                            value as String, fg as Number, dim as Number, bar as Number, bgc as Number) as Void {
        var lh = dc.getFontHeight(Graphics.FONT_XTINY);
        if (bgc >= 0) {
            dc.setColor(bgc, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(x + 3, y + 3, tw - 6, th - 6, 8);
            fg = (bgc == C_DEC_RED) ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK;
            dim = fg;
        }
        dc.setColor(dim, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x + 8, y + 2, Graphics.FONT_XTINY, label, Graphics.TEXT_JUSTIFY_LEFT);
        var room = tw - 16 - ((bar >= 0) ? 14 : 0);
        var f = fitFont(dc, value, room, th - lh - 4);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x + 8 + room / 2, y + lh + (th - lh) / 2, f, value, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        if (bar >= 0) {
            dc.setColor(bar, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(x + tw - 16, y + lh + 6, 10, th - lh - 14, 4);
        }
    }

    // "#0099FF" to 0x0099FF; null if it does not parse
    private function hexColour(s as Object or Null) as Number or Null {
        if (!(s instanceof String)) { return null; }
        var str = s as String;
        if (str.length() != 7) { return null; }
        var hex = str.substring(1, 7);
        if (hex == null) { return null; }
        return (hex as String).toNumberWithBase(16);
    }

    private function hms(sec as Number) as String {
        if (sec < 3600) { return mmss(sec); }
        var hh = sec / 3600; var m = (sec % 3600) / 60; var s = sec % 60;
        return hh.format("%d") + ":" + m.format("%02d") + ":" + s.format("%02d");
    }

    private function mmss(sec as Number) as String {
        var m = sec / 60; var s = sec % 60;
        return m.format("%d") + ":" + s.format("%02d");
    }

    private function syncWord() as String {
        if (_rideId == 0) { return "The Way: ready"; }
        if (_sending) { return "The Way: sending"; }
        if (_lastOkAt > 0) {
            var ago = Time.now().value() - _lastOkAt;
            return "The Way: " + hms(_sentSeconds) + " kept, " + (ago < 60 ? "just now" : mmss(ago) + " ago");
        }
        if (_lastCode < 0) { return "The Way: no phone (" + _lastCode.format("%d") + ")"; }
        if (_lastCode > 0) { return "The Way: " + _lastCode.format("%d"); }
        return "The Way: waiting";
    }

    // ---- the screen ----
    public function onUpdate(dc as Dc) as Void {
        var w = dc.getWidth(); var h = dc.getHeight();
        var bg = getBackgroundColor();
        var fg = (bg == Graphics.COLOR_BLACK) ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK;
        var dim = (bg == Graphics.COLOR_BLACK) ? Graphics.COLOR_LT_GRAY : Graphics.COLOR_DK_GRAY;
        dc.setColor(fg, bg);
        dc.clear();
        var pw = (_power == null) ? "--" : _power.format("%d");
        var hr = (_hr == null) ? "--" : _hr.format("%d");
        var cad = (_cad == null) ? "--" : _cad.format("%d");

        if (h < 110) {
            // a small field: one line of the numbers, the sync in a word
            dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h / 2 - 2, Graphics.FONT_MEDIUM, pw + " W  " + hr + " bpm  " + cad, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(dim, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h - 12, Graphics.FONT_XTINY, (_lastOkAt > 0 ? "The Way ok" : syncWord()), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }

        var xh = dc.getFontHeight(Graphics.FONT_XTINY);
        var sh = dc.getFontHeight(Graphics.FONT_SMALL);
        var mid = h / 2;

        // top half: the session's name, then the three buckets
        dc.setColor(dim, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, 4, Graphics.FONT_XTINY, (_sessionName != null) ? _sessionName : "The Way", Graphics.TEXT_JUSTIFY_CENTER);
        var barTop = 4 + xh + 4 + xh + 6;
        var barBot = mid - sh - xh - 10;
        if (barBot - barTop >= 40) { drawBuckets(dc, barTop, barBot, w, fg, dim); }
        dc.setColor(dim, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(1);
        dc.drawLine(10, mid, w - 10, mid);

        // bottom half: heart | watts, decoupling | on plan, time; then the next calendar event on its own line at the very bottom
        var syncTop = h - xh - 4;
        var sh2 = dc.getFontHeight(Graphics.FONT_SMALL);
        var nextTop = syncTop - sh2 - 2;
        var rowH = (nextTop - mid - 4) / 3;
        var tw = w / 2;
        var hz = zoneOf(null, _hr);
        var hrBar = (hz == 2) ? _colPeak : ((hz == 1) ? _colHigh : ((hz == 0) ? _colLow : -1));
        var dec = decoupling();
        var decS = "--";
        if (dec != null) {
            var d = dec as Float;
            if (d > -0.05 && d < 0.05) { d = 0.0; }          // no "-0.0"
            decS = d.format("%.1f");
        }
        var onS = (_plannedS > 0) ? (_onPlanS * 100 / _plannedS).format("%d") : "--";
        var nextLine = "next event: --";
        if (_nextAt > 0) {
            var left = _nextAt - Time.now().value();
            if (left < 0) { left = 0; }
            // a countdown that ticks every second: h:mm:ss, or m:ss inside the last hour
            var t = (_nextTitle != null) ? (_nextTitle as String) : "next event";
            if (t.length() > 20) { t = t.substring(0, 20); }
            nextLine = t + "  " + ((left > 0) ? ("-" + hms(left)) : "now");
        }
        var y0 = mid + 4;
        tile(dc, 0, y0, tw, rowH, "heart", hr, fg, dim, hrBar);
        tile(dc, tw, y0, tw, rowH, "watts", pw, fg, dim, -1);
        var decBg = -1;
        if (dec != null) {
            var dv = dec as Float;
            decBg = (dv > 10.0) ? C_DEC_RED : ((dv >= 5.0) ? C_DEC_YELLOW : C_DEC_GREEN);
        }
        tileOn(dc, 0, y0 + rowH, tw, rowH, "decoupling %", decS, fg, dim, -1, decBg);
        tile(dc, tw, y0 + rowH, tw, rowH, "on plan %", onS, fg, dim, -1);
        tile(dc, 0, y0 + 2 * rowH, w, rowH, "time", hms(_timerS), fg, dim, -1);
        dc.setColor(dim, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(1);
        dc.drawLine(tw, y0 + 4, tw, y0 + 2 * rowH - 4);
        dc.drawLine(10, y0 + 3 * rowH, w - 10, y0 + 3 * rowH);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, nextTop, Graphics.FONT_SMALL, nextLine, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawLine(10, y0 + rowH, w - 10, y0 + rowH);
        dc.drawLine(10, y0 + 2 * rowH, w - 10, y0 + 2 * rowH);

        // the site
        var ok = (_lastOkAt > 0) && (Time.now().value() - _lastOkAt < 120);
        var trouble = (_rideId != 0) && !ok && (_lastCode != 0);
        dc.setColor(trouble ? fg : dim, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, syncTop, Graphics.FONT_XTINY, syncWord(), Graphics.TEXT_JUSTIFY_CENTER);
    }
}
