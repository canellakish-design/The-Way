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
        _t.add(t); _p.add(_power); _h.add(_hr); _c.add(_cad);
        var sp = info.currentSpeed;
        _s.add(sp == null ? null : sp * 3.6);
        while (_t.size() > KEEP_MAX) { _t = _t.slice(1, null); _p = _p.slice(1, null); _h = _h.slice(1, null); _c = _c.slice(1, null); _s = _s.slice(1, null); }
        if (t >= _nextSendAt) { send(false); }
    }

    private function startRide() as Void {
        _rideId = Time.now().value();
        _t = []; _p = []; _h = []; _c = []; _s = [];
        _lastT = -1; _aboveS = 0; _sentSeconds = 0; _done = false; _nextSendAt = BATCH_S;
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

    private function mmss(sec as Number) as String {
        var m = sec / 60; var s = sec % 60;
        return m.format("%d") + ":" + s.format("%02d");
    }

    private function syncWord() as String {
        if (_rideId == 0) { return "The Way: ready"; }
        if (_sending) { return "The Way: sending"; }
        if (_lastOkAt > 0) {
            var ago = Time.now().value() - _lastOkAt;
            return "The Way: " + mmss(_sentSeconds) + " kept, " + (ago < 60 ? "just now" : mmss(ago) + " ago");
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

        var y = 6;
        // the session's name, or the day without one
        dc.setColor(dim, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, y, Graphics.FONT_XTINY, (_sessionName != null) ? _sessionName : "The Way", Graphics.TEXT_JUSTIFY_CENTER);
        y += dc.getFontHeight(Graphics.FONT_XTINY) + 4;

        // the three numbers now
        var big = (h >= 300) ? Graphics.FONT_NUMBER_HOT : Graphics.FONT_NUMBER_MEDIUM;
        var bigH = dc.getFontHeight(big);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 6, y, big, pw, Graphics.TEXT_JUSTIFY_CENTER);
        var hrColor = fg;
        if (_hr != null && _hr >= _vt2) { hrColor = Graphics.COLOR_RED; }
        else if (_hr != null && _hr > 116) { hrColor = Graphics.COLOR_ORANGE; }
        else if (_hr != null) { hrColor = Graphics.COLOR_GREEN; }
        dc.setColor(hrColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, y, big, hr, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(5 * w / 6, y, big, cad, Graphics.TEXT_JUSTIFY_CENTER);
        y += bigH;
        dc.setColor(dim, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 6, y, Graphics.FONT_XTINY, "watts", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w / 2, y, Graphics.FONT_XTINY, "heart", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(5 * w / 6, y, Graphics.FONT_XTINY, "rpm", Graphics.TEXT_JUSTIFY_CENTER);
        y += dc.getFontHeight(Graphics.FONT_XTINY) + 8;

        // the step the plan is on, and its target
        var st = stepNow();
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        if (st != null) {
            var start = st[0] as Number; var dur = st[1] as Number; var tw = st[2] as Number; var lo = st[3] as Number; var hi = st[4] as Number;
            var left = start + dur - _timerS;
            var target = "ride by feel";
            if (tw > 0) { target = tw.format("%d") + " W"; }
            else if (hi > 0) { target = "HR " + lo.format("%d") + "-" + hi.format("%d"); }
            dc.drawText(w / 2, y, Graphics.FONT_SMALL, target + "  ·  " + mmss(left) + " left", Graphics.TEXT_JUSTIFY_CENTER);
        } else if (_steps.size() > 0 && _timerS > 0) {
            dc.drawText(w / 2, y, Graphics.FONT_SMALL, "session done: ride easy", Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.drawText(w / 2, y, Graphics.FONT_SMALL, (_running ? "no session today: ride by feel" : "press start"), Graphics.TEXT_JUSTIFY_CENTER);
        }
        y += dc.getFontHeight(Graphics.FONT_SMALL) + 6;

        // minutes above the line, and the clock
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, y, Graphics.FONT_SMALL, "above " + _vt2.format("%d") + ": " + mmss(_aboveS) + "   ·   " + mmss(_timerS), Graphics.TEXT_JUSTIFY_CENTER);
        y += dc.getFontHeight(Graphics.FONT_SMALL) + 6;

        // the site
        var ok = (_lastOkAt > 0) && (Time.now().value() - _lastOkAt < 120);
        dc.setColor(ok ? Graphics.COLOR_GREEN : dim, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h - dc.getFontHeight(Graphics.FONT_XTINY) - 4, Graphics.FONT_XTINY, syncWord(), Graphics.TEXT_JUSTIFY_CENTER);
    }
}
