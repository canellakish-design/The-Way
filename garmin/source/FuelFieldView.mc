using Toybox.WatchUi as Ui;
using Toybox.Graphics as Gfx;
using Toybox.Activity;
using Toybox.Application as App;
using Toybox.Communications as Comm;
using Toybox.System as Sys;
using Toybox.Math;
using Toybox.Attention;

// The Way — Ride. One codebase, per-device faces:
//   Edge 530 (color)      : full face
//   Edge 130 Plus (mono)  : essentials face
// Set a 1-field ride screen and select this field.
class FuelFieldView extends Ui.DataField {

    // ---- settings ----
    hidden var mFtp = 265.0;
    hidden var mCarbShift = 0.0;
    hidden var mFastedSetting = false;
    hidden var mBridgeUrl = "";
    hidden var mToken = "";
    hidden var mBallCarbs = 19.0;   // Spicy Anchovy Rice Balls v1
    hidden var mReplace = 0.75;
    hidden var mLapLogs = false;

    // ---- bridge state ----
    hidden var mFasted = false;
    hidden var mCarbsOnBoard = 0.0;
    hidden var mBalanceStart = 0.0; // day balance at ride start (kcal)
    hidden var mHaveBalance = false;
    hidden var mSource = 0;         // 0 settings, 1 bridge
    hidden var mFetchState = 0;
    hidden var mRetries = 0;
    hidden var mNextTryAt = 0;

    // ---- rolling NP ----
    hidden var mBuf;
    hidden var mBufIdx = 0;
    hidden var mBufCount = 0;
    hidden var mBufSum = 0.0;
    hidden var mNpSum = 0.0;
    hidden var mNpCount = 0;

    // ---- live metrics ----
    hidden var mPower = 0;
    hidden var mNp = 0.0;
    hidden var mIf = 0.0;
    hidden var mTss = 0.0;
    hidden var mKcal = 0.0;
    hidden var mCarbKcal = 0.0;
    hidden var mFatKcal = 0.0;
    hidden var mElapsed = 0;
    hidden var mDistM = 0.0;

    // ---- RICE accumulator ----
    hidden var mRiceOwed = 0.0;
    hidden var mRiceEaten = 0;
    hidden var mRiceAlerted = 0;

    function initialize() {
        DataField.initialize();
        mBuf = new [30];
        for (var i = 0; i < 30; i++) { mBuf[i] = 0; }
        loadSettings();
    }

    function loadSettings() {
        var v = App.Properties.getValue("ftp");
        if (v != null && v > 0) { mFtp = v.toFloat(); }
        v = App.Properties.getValue("carbShift");
        if (v != null) { mCarbShift = v.toFloat() / 100.0; }
        v = App.Properties.getValue("fasted");
        if (v != null) { mFastedSetting = v; }
        v = App.Properties.getValue("bridgeUrl");
        if (v != null) { mBridgeUrl = v; }
        v = App.Properties.getValue("token");
        if (v != null) { mToken = v; }
        v = App.Properties.getValue("ballCarbs");
        if (v != null && v > 0) { mBallCarbs = v.toFloat(); }
        v = App.Properties.getValue("replacePct");
        if (v != null) { mReplace = v.toFloat() / 100.0; }
        v = App.Properties.getValue("lapLogsFuel");
        if (v != null) { mLapLogs = v; }
        if (mSource == 0) { mFasted = mFastedSetting; }
    }

    // ---------------- bridge fetch ----------------
    function fetchFuelState() {
        mFetchState = 1;
        var url = mBridgeUrl + "/fuel-state";
        var params = { "token" => mToken };
        var options = {
            :method => Comm.HTTP_REQUEST_METHOD_GET,
            :responseType => Comm.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        Comm.makeWebRequest(url, params, options, method(:onFuelState));
    }

    function onFuelState(code, data) {
        if (code == 200 && data != null && data["fresh"] == true) {
            if (data["fasted"] != null) { mFasted = data["fasted"]; }
            if (data["carbs_g"] != null) { mCarbsOnBoard = data["carbs_g"].toFloat(); }
            if (data["ball_carbs_g"] != null && data["ball_carbs_g"] > 0) {
                mBallCarbs = data["ball_carbs_g"].toFloat();
            }
            if (data["balance_kcal"] != null) {
                mBalanceStart = data["balance_kcal"].toFloat();
                mHaveBalance = true;
            }
            mSource = 1;
            mFetchState = 2;
        } else {
            mSource = 0;
            mFasted = mFastedSetting;
            mRetries++;
            if (mRetries >= 3) { mFetchState = 2; }
            else { mFetchState = 0; mNextTryAt = mElapsed + 120; }
        }
        Ui.requestUpdate();
    }

    // ---------------- substrate model ----------------
    function baseCarbFraction(rel) {
        if (rel <= 0.50) { return 0.45; }
        if (rel >= 0.95) { return 1.00; }
        if (rel <= 0.65) { return 0.45 + (rel - 0.50) / 0.15 * 0.20; }
        if (rel <= 0.80) { return 0.65 + (rel - 0.65) / 0.15 * 0.15; }
        return 0.80 + (rel - 0.80) / 0.15 * 0.20;
    }

    function carbFraction(rel, tSec) {
        var f = baseCarbFraction(rel) + mCarbShift;
        if (mFasted) { f += (tSec < 3600) ? -0.08 : -0.05; }
        var driftStart = 5400 + (mCarbsOnBoard * 30).toNumber();
        if (tSec > driftStart) { f -= 0.03 * (tSec - driftStart) / 3600.0; }
        if (f > 1.0) { f = 1.0; }
        if (f < 0.15) { f = 0.15; }
        return f;
    }

    // ---------------- lap button = ate one ball ----------------
    function onTimerLap() {
        if (mLapLogs && !mFasted) { mRiceEaten++; }
    }

    // ---------------- per-second compute ----------------
    function compute(info) {
        mElapsed = (info.timerTime != null) ? info.timerTime / 1000 : 0;
        mDistM = (info.elapsedDistance != null) ? info.elapsedDistance : 0.0;

        if (mFetchState == 0 && mBridgeUrl.length() > 0
            && mElapsed >= mNextTryAt
            && Sys.getDeviceSettings().phoneConnected) {
            fetchFuelState();
        }

        var running = true;
        if (info has :timerState && info.timerState != null) {
            running = (info.timerState == Activity.TIMER_STATE_ON);
        }

        var pwr = (info.currentPower != null) ? info.currentPower : null;
        mPower = (pwr != null) ? pwr : 0;

        if (running && pwr != null) {
            if (mBufCount < 30) {
                mBuf[mBufIdx] = pwr; mBufSum += pwr; mBufCount++;
            } else {
                mBufSum += pwr - mBuf[mBufIdx];
                mBuf[mBufIdx] = pwr;
            }
            mBufIdx = (mBufIdx + 1) % 30;

            var avg30 = (mBufCount > 0) ? mBufSum / mBufCount : 0.0;
            if (mBufCount >= 30) {
                mNpSum += Math.pow(avg30, 4);
                mNpCount++;
                mNp = Math.pow(mNpSum / mNpCount, 0.25).toFloat();
            }

            var kcalSec = pwr / 1000.0;
            mKcal += kcalSec;
            var frac = carbFraction(avg30 / mFtp, mElapsed);
            mCarbKcal += kcalSec * frac;
            mFatKcal += kcalSec * (1.0 - frac);

            // RICE: replace a fraction of carbs burned beyond what
            // breakfast put on board (grace), in units of one ball.
            if (!mFasted) {
                var carbsBurned = mCarbKcal / 4.0;
                var beyond = carbsBurned - mCarbsOnBoard;
                if (beyond > 0) {
                    mRiceOwed = beyond * mReplace / mBallCarbs;
                    var whole = mRiceOwed.toNumber();
                    if (whole > mRiceAlerted) {
                        mRiceAlerted = whole;
                        if (Attention has :playTone) {
                            Attention.playTone(Attention.TONE_ALERT_HI);
                        }
                    }
                }
            }
        }

        if (mNp > 0 && mFtp > 0) {
            mIf = mNp / mFtp;
            if (mElapsed > 0) {
                mTss = (mElapsed * mNp * mIf) / (mFtp * 3600.0) * 100.0;
            }
        }
        return null;
    }

    // ---------------- drawing ----------------
    function onUpdate(dc) {
        if (Sys.getDeviceSettings().screenWidth <= 235) {
            drawMono(dc);
        } else {
            drawColor(dc);
        }
    }

    hidden function bal() { return mBalanceStart - mKcal; }

    // ---- Edge 130 Plus: essentials, monochrome ----
    function drawMono(dc) {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var bg = getBackgroundColor();
        var fg = (bg == Gfx.COLOR_BLACK) ? Gfx.COLOR_WHITE : Gfx.COLOR_BLACK;
        dc.setColor(fg, bg);
        dc.clear();
        dc.setColor(fg, Gfx.COLOR_TRANSPARENT);

        dc.drawText(2, 0, Gfx.FONT_TINY, fmtTime(mElapsed), Gfx.TEXT_JUSTIFY_LEFT);
        dc.drawText(w / 2, 0, Gfx.FONT_TINY, clockStr(), Gfx.TEXT_JUSTIFY_CENTER);
        dc.drawText(w - 2, 0, Gfx.FONT_TINY,
                    (mDistM / 1609.34).format("%.1f"), Gfx.TEXT_JUSTIFY_RIGHT);

        dc.drawText(w / 2, h * 0.07, Gfx.FONT_NUMBER_THAI_HOT,
                    mPower.format("%d"), Gfx.TEXT_JUSTIFY_CENTER);

        var y = h * 0.42;
        drawCell(dc, w * 0.25, y, "KCAL", mKcal.format("%d"), fg, fg);
        drawCell(dc, w * 0.75, y, "RICE",
                 mFasted ? "--" : mRiceOwed.format("%.1f"), fg, fg);

        y = h * 0.60;
        drawCell(dc, w * 0.25, y, "CARB", (mCarbKcal / 4.0).format("%d") + "g", fg, fg);
        drawCell(dc, w * 0.75, y, "FAT", (mFatKcal / 9.0).format("%d") + "g", fg, fg);

        // BAL line: inverted block when deep
        var by = (h * 0.80).toNumber();
        if (mHaveBalance) {
            var b = bal();
            var deep = (b < -900);
            if (deep) {
                dc.setColor(fg, Gfx.COLOR_TRANSPARENT);
                dc.fillRectangle(0, by - 2, w, dc.getFontHeight(Gfx.FONT_SMALL) + 4);
                dc.setColor(bg, Gfx.COLOR_TRANSPARENT);
            }
            dc.drawText(w / 2, by, Gfx.FONT_SMALL,
                        "BAL " + b.format("%d") + (deep ? "  EAT" : "  OK"),
                        Gfx.TEXT_JUSTIFY_CENTER);
            dc.setColor(fg, Gfx.COLOR_TRANSPARENT);
        } else {
            dc.drawText(w / 2, by, Gfx.FONT_SMALL, "BAL --", Gfx.TEXT_JUSTIFY_CENTER);
        }

        dc.drawText(w / 2, h - dc.getFontHeight(Gfx.FONT_XTINY) - 1, Gfx.FONT_XTINY,
                    statusStr(), Gfx.TEXT_JUSTIFY_CENTER);
    }

    // ---- Edge 530: full color face ----
    function drawColor(dc) {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var bg = getBackgroundColor();
        var fg = (bg == Gfx.COLOR_BLACK) ? Gfx.COLOR_WHITE : Gfx.COLOR_BLACK;
        dc.setColor(fg, bg);
        dc.clear();
        dc.setColor(fg, Gfx.COLOR_TRANSPARENT);

        dc.drawText(4, 2, Gfx.FONT_TINY, fmtTime(mElapsed), Gfx.TEXT_JUSTIFY_LEFT);
        dc.drawText(w / 2, 2, Gfx.FONT_TINY, clockStr(), Gfx.TEXT_JUSTIFY_CENTER);
        dc.drawText(w - 4, 2, Gfx.FONT_TINY,
                    (mDistM / 1609.34).format("%.1f") + " mi", Gfx.TEXT_JUSTIFY_RIGHT);

        dc.drawText(w / 2, h * 0.06, Gfx.FONT_NUMBER_THAI_HOT,
                    mPower.format("%d"), Gfx.TEXT_JUSTIFY_CENTER);

        var y = h * 0.36;
        drawCell(dc, w * 0.25, y, "NP", (mNp > 0) ? mNp.format("%d") : "--", fg, fg);
        drawCell(dc, w * 0.75, y, "IF",
                 (mIf > 0) ? mIf.format("%.2f") : "--", fg, ifColor(fg));

        y = h * 0.52;
        drawCell(dc, w * 0.25, y, "TSS", mTss.format("%d"), fg, fg);
        drawCell(dc, w * 0.75, y, "KCAL", mKcal.format("%d"), fg, fg);

        // substrate bar
        var carbsG = mCarbKcal / 4.0;
        var fatG = mFatKcal / 9.0;
        var barY = (h * 0.70).toNumber();
        var barH = (h * 0.07).toNumber();
        var total = mCarbKcal + mFatKcal;
        var carbW = (total > 0) ? (w * (mCarbKcal / total)).toNumber() : 0;
        dc.setColor(Gfx.COLOR_ORANGE, Gfx.COLOR_TRANSPARENT);
        dc.fillRectangle(0, barY, carbW, barH);
        dc.setColor(Gfx.COLOR_BLUE, Gfx.COLOR_TRANSPARENT);
        dc.fillRectangle(carbW, barY, w - carbW, barH);
        dc.setColor(fg, Gfx.COLOR_TRANSPARENT);
        dc.drawText(4, barY + barH + 1, Gfx.FONT_SMALL,
                    "C " + carbsG.format("%d") + "g", Gfx.TEXT_JUSTIFY_LEFT);
        dc.drawText(w - 4, barY + barH + 1, Gfx.FONT_SMALL,
                    "F " + fatG.format("%d") + "g", Gfx.TEXT_JUSTIFY_RIGHT);

        // RICE + BAL row
        var ry = (h * 0.84).toNumber();
        var riceHot = (!mFasted && mRiceOwed - mRiceEaten >= 1.0);
        drawCell(dc, w * 0.25, ry, "RICE",
                 mFasted ? "--" : mRiceOwed.format("%.1f"),
                 fg, riceHot ? Gfx.COLOR_RED : fg);
        if (mHaveBalance) {
            var b = bal();
            var bc = (b < -900) ? Gfx.COLOR_RED :
                     ((b >= -600 && b <= -300) ? Gfx.COLOR_DK_GREEN : Gfx.COLOR_ORANGE);
            drawCell(dc, w * 0.75, ry, "BAL", b.format("%d"), fg, bc);
        } else {
            drawCell(dc, w * 0.75, ry, "BAL", "--", fg, fg);
        }

        dc.drawText(w / 2, h - dc.getFontHeight(Gfx.FONT_XTINY) - 1, Gfx.FONT_XTINY,
                    statusStr(), Gfx.TEXT_JUSTIFY_CENTER);
    }

    function statusStr() {
        var s;
        if (mSource == 1) {
            s = mFasted ? "FUEL: FASTED" : "FUEL " + mCarbsOnBoard.format("%d") + "g";
        } else if (mFetchState == 1) {
            s = "SYNC...";
        } else {
            s = mFasted ? "\u2248 FASTED (SET)" : "\u2248 SETTINGS";
        }
        if (mLapLogs && mRiceEaten > 0) {
            s += "  ATE " + mRiceEaten.format("%d");
        }
        return s;
    }

    function drawCell(dc, x, y, label, val, fg, valCol) {
        dc.setColor(fg, Gfx.COLOR_TRANSPARENT);
        dc.drawText(x, y, Gfx.FONT_XTINY, label, Gfx.TEXT_JUSTIFY_CENTER);
        dc.setColor(valCol, Gfx.COLOR_TRANSPARENT);
        dc.drawText(x, y + dc.getFontHeight(Gfx.FONT_XTINY),
                    Gfx.FONT_NUMBER_MEDIUM, val, Gfx.TEXT_JUSTIFY_CENTER);
        dc.setColor(fg, Gfx.COLOR_TRANSPARENT);
    }

    function ifColor(fg) {
        if (mIf <= 0) { return fg; }
        if (mIf < 0.75) { return Gfx.COLOR_DK_GREEN; }
        if (mIf < 0.90) { return Gfx.COLOR_YELLOW; }
        if (mIf < 1.05) { return Gfx.COLOR_ORANGE; }
        return Gfx.COLOR_RED;
    }

    function clockStr() {
        var ct = Sys.getClockTime();
        var hr = ct.hour;
        if (!Sys.getDeviceSettings().is24Hour) {
            hr = hr % 12;
            if (hr == 0) { hr = 12; }
        }
        return hr.format("%d") + ":" + ct.min.format("%02d");
    }

    function fmtTime(s) {
        var hh = s / 3600;
        var mm = (s % 3600) / 60;
        var ss = s % 60;
        if (hh > 0) {
            return hh.format("%d") + ":" + mm.format("%02d") + ":" + ss.format("%02d");
        }
        return mm.format("%d") + ":" + ss.format("%02d");
    }
}
