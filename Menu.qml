import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "Model.js" as Model

// MicroVMs on a keybind or a menu row, over whatever you were working in.
//
// The same list, form and log as the bar popup (it hosts the same
// MicrovmView, over the same MicrovmState), but it does not need the widget
// to be in the bar, and it holds the keyboard for as long as it is up.
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

  // A full-screen surface is read from further away than a bar popup, so the
  // whole view is drawn larger: the same factor nixarchy-pkg's menu uses.
  // Safe here because nothing in the view pops up (no QQC Popup ignores it).
  readonly property real uiScale: 1.45
  readonly property int viewWidth: Style.space(680)

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
    root.opened = true
  }

  function close() {
    if (root.opened) MicrovmState.release("view")
    view.dismiss()
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

  PanelWindow {
    id: panel
    visible: root.opened
    screen: root.targetScreen
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore

    WlrLayershell.namespace: "nixarchy-microvm-menu"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive

    onVisibleChanged: if (visible) Qt.callLater(function() { view.focusForMode() })

    Rectangle {
      anchors.fill: parent
      color: Color.menu.scrim
    }

    // A click away closes, as every summoned surface here does. The card
    // swallows its own clicks so they never reach this.
    MouseArea {
      anchors.fill: parent
      onClicked: root.close()
    }

    BorderSurface {
      id: card
      width: Math.min(Math.round(root.viewWidth * root.uiScale) + card.contentLeftInset + card.contentRightInset,
                      Math.round(panel.width * 0.9))
      height: Math.min(Math.round(view.implicitHeight * root.uiScale) + card.contentTopInset + card.contentBottomInset,
                       Math.round(panel.height * 0.85))
      anchors.horizontalCenter: parent.horizontalCenter
      y: Math.max(Style.gapsOut, Math.round((panel.height - height) / 3))
      color: Color.popups.background
      borderSpec: Border.surfaceSpec("popups", "border", Color.popups.border, Math.max(1, Style.space(2)))
      padding: Style.spacing.popupPadding
      radius: Style.cornerRadius

      MouseArea { anchors.fill: parent; onClicked: {} }

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
          // Laid out at its natural size, then drawn uiScale times larger;
          // input is mapped through the same transform, so clicks still land.
          width: frame.width / root.uiScale
          height: frame.height / root.uiScale
          scale: root.uiScale
          transformOrigin: Item.TopLeft
          foreground: Color.foreground
          fontFamily: Style.font.family
          onCloseRequested: root.close()
          // No neighbouring bar panel to hand over to.
          onSwitchPanelRequested: function(direction) {}
        }
      }
    }
  }
}
