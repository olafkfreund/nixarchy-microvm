import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "Model.js" as Model

// MicroVMs on a keybind or a menu row, over whatever you were working in.
//
//   omarchy-shell shell toggle nixarchy.microvm '{}'
//   omarchy-shell shell toggle nixarchy.microvm '{"create":true}'
//
// plan step 7: a placeholder card until the view lands in step 8.
Item {
  id: root

  // Injected by omarchy-shell when this plugin is summoned.
  property var shell: null
  property var manifest: null

  property bool opened: false
  property var targetScreen: null

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

  function open(payloadJson) {
    MicrovmState.settings = root.readSettings()
    root.targetScreen = root.focusedScreen()
    if (!root.opened) MicrovmState.acquire("view")
    root.opened = true
  }

  function close() {
    if (root.opened) MicrovmState.release("view")
    root.opened = false
  }

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

    Rectangle {
      anchors.fill: parent
      color: Color.menu.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.close()
    }

    BorderSurface {
      id: card
      width: Math.min(Math.round(root.viewWidth * root.uiScale) + card.contentLeftInset + card.contentRightInset,
                      Math.round(panel.width * 0.9))
      height: Math.round(placeholder.implicitHeight * root.uiScale) + card.contentTopInset + card.contentBottomInset
      anchors.horizontalCenter: parent.horizontalCenter
      y: Math.max(Style.gapsOut, Math.round((panel.height - height) / 3))
      color: Color.popups.background
      borderSpec: Border.surfaceSpec("popups", "border", Color.popups.border, Math.max(1, Style.space(2)))
      padding: Style.spacing.popupPadding
      radius: Style.cornerRadius

      MouseArea { anchors.fill: parent; onClicked: {} }

      Text {
        id: placeholder
        anchors.fill: parent
        anchors.margins: card.contentTopInset
        text: "MicroVMs · " + Model.footerText(MicrovmState.allRows)
        textFormat: Text.PlainText
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.body
        focus: true
        Keys.onEscapePressed: root.close()
      }
    }
  }
}
