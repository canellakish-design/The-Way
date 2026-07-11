using Toybox.Application as App;
using Toybox.WatchUi as Ui;

class FuelFieldApp extends App.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function getInitialView() {
        return [ new FuelFieldView() ];
    }

    // Re-read FTP / carb shift when the user changes them in Connect Mobile
    function onSettingsChanged() {
        Ui.requestUpdate();
    }
}
