import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model

// MicroVMs on a keybind or a menu row, over whatever you were working in.
//
// The same list, form and log as the bar popup (it hosts the same
// MicrovmView, over the same MicrovmState), but it does not need the widget
// to be in the bar. The window is the card itself, centred at the top of the
// focused screen with nothing dimmed; a click outside it closes it.
//
//   omarchy-shell shell toggle nixarchy.microvm '{}'
//   omarchy-shell shell toggle nixarchy.microvm '{"create":true}'
Item {
  id: root

  // Injected by omarchy-shell when this plugin is summoned.
  property var shell: null
  property var manifest: null

  property bool opened: false
  property var targetScreen: null

  // True once the Exclusive keyboard prime is over; see panel's keyboardFocus.
  property bool focusPrimed: false

  Timer {
    id: focusPrimeTimer
    interval: 75
    onTriggered: if (root.opened) root.focusPrimed = true
  }

  readonly property var screenFor: root.targetScreen
    || (Quickshell.screens.length > 0 ? Quickshell.screens[0] : null)

  // The menu takes a share of the monitor it opens on, not a fixed rem width.
  // 1100 matches nixarchy.pkg's menu.
  readonly property var geometry: Model.menuGeometry(
    screenFor ? screenFor.width : 0, screenFor ? screenFor.height : 0,
    Style.space(560), Style.space(1100), view.implicitHeight,
    card.contentLeftInset + card.contentRightInset,
    card.contentTopInset + card.contentBottomInset, Style.gapsOut)

  function focusedScreen() {
    var monitor = Hyprland.focusedMonitor
    var name = monitor ? String(monitor.name || "") : ""
    var screens = Quickshell.screens
    for (var i = 0; i < screens.length; i++)
      if (screens[i].name === name) return screens[i]
    return null
  }

  function readSettings() {
    var defaults = manifest && manifest.barWidget && manifest.barWidget.defaults
      ? manifest.barWidget.defaults : ({})
    var id = manifest && manifest.id ? manifest.id : "nixarchy.microvm"
    return Model.settingsFor(shell ? shell.barConfig : null, id, defaults)
  }

  function wantsCreate(payloadJson) {
    try {
      var payload = JSON.parse(String(payloadJson || "{}"))
      return !!(payload && payload.create === true)
    } catch (e) {
      return false
    }
  }

  // Plugin lifecycle: the host calls open(payloadJson) on summon and close()
  // on hide, and reads `opened` to decide what `toggle` means. keepLoaded, so
  // every open starts from a clean slate.
  function open(payloadJson) {
    MicrovmState.settings = root.readSettings()
    root.targetScreen = root.focusedScreen()
    if (!root.opened) MicrovmState.acquire("view")
    view.reset()
    if (root.wantsCreate(payloadJson)) view.openForm("disposable")
    root.focusPrimed = false
    root.opened = true
  }

  function close() {
    if (root.opened) MicrovmState.release("view")
    view.dismiss()
    focusPrimeTimer.stop()
    root.focusPrimed = false
    root.opened = false
  }

  // Panel.qml:43-46's shape. A no-op when the host did call close(); when it
  // did not, it stops a leaked hold keeping the 3 s poll alive with every
  // surface shut.
  Component.onDestruction: if (root.opened) MicrovmState.release("view")

  function toggle() {
    if (root.opened) root.close()
    else root.open("{}")
  }

  // `omarchy-shell shell call nixarchy.microvm status ''`
  function status() { return MicrovmState.statusJson() }

  // Same grab as Ui/PopupCard.qml:87-94: a click outside the window clears it.
  HyprlandFocusGrab {
    active: root.opened && panel.backingWindowVisible && root.focusPrimed
    windows: [panel]
    onCleared: root.close()
  }

  PanelWindow {
    id: panel
    visible: root.opened
    screen: root.screenFor
    anchors { top: true }
    margins.top: root.geometry.top
    implicitWidth: root.geometry.width
    implicitHeight: root.geometry.height
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore

    WlrLayershell.namespace: "nixarchy-microvm-menu"
    WlrLayershell.layer: WlrLayer.Overlay
    // Exclusive for a 75 ms prime so the compositor hands us focus, then
    // OnDemand so the grab can take it back (Ui/KeyboardPanel.qml:150-160).
    WlrLayershell.keyboardFocus: root.opened
      ? (root.focusPrimed ? WlrKeyboardFocus.OnDemand : WlrKeyboardFocus.Exclusive)
      : WlrKeyboardFocus.None

    onBackingWindowVisibleChanged: if (backingWindowVisible && root.opened) focusPrimeTimer.restart()
    onVisibleChanged: if (visible) Qt.callLater(function() { view.focusForMode() })

    BorderSurface {
      id: card
      anchors.fill: parent
      color: Commons.Color.popups.background
      borderSpec: Border.surfaceSpec("popups", "border", Commons.Color.popups.border, Math.max(1, Style.space(2)))
      padding: Style.spacing.popupPadding
      radius: Style.cornerRadius

      Item {
        id: frame
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        clip: true

        MicrovmView {
          id: view
          anchors.fill: parent
          surface: "menu"
          large: true
          foreground: Commons.Color.foreground
          fontFamily: Style.font.family
          onCloseRequested: root.close()
          // No neighbouring bar panel to hand over to.
          onSwitchPanelRequested: function(direction) {}
        }
      }
    }
  }
}
