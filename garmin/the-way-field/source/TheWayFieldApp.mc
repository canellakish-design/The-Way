// The Way on the Edge: a data field that records the ride into the site (bridge/garmin.js).
import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

class TheWayFieldApp extends Application.AppBase {

    public function initialize() {
        AppBase.initialize();
    }

    public function onStart(state as Dictionary?) as Void {
    }

    public function onStop(state as Dictionary?) as Void {
    }

    public function getInitialView() as [Views] or [Views, InputDelegates] {
        return [new $.TheWayField()];
    }
}
