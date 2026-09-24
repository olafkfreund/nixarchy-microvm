import QtQuick
import Quickshell
import Quickshell.Io
import qs.Ui
import qs.Commons
import "Model.js" as Model

// The bar widget: a glyph that keeps an eye on your VMs, and a keyboard popup
// under it. The data lives in the MicrovmState singleton, shared with the
// full-screen menu (Menu.qml).
Panel {
  id: root

  moduleName: "nixarchy.microvm"
  ipcTarget: "nixarchy.microvm.bar"
  manageIpc: false

  readonly property int refreshIntervalSec: Math.max(5, Number(setting("refreshIntervalSec", 30)))
  readonly property bool showStopped: setting("showStopped", true) === true
  readonly property bool hideWhenEmpty: setting("hideWhenEmpty", false) === true
  readonly property bool aiAssist: setting("aiAssist", true) === true

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  function pushSettings() {
    MicrovmState.settings = {
      refreshIntervalSec: root.refreshIntervalSec,
      showStopped: root.showStopped,
      hideWhenEmpty: root.hideWhenEmpty,
      aiAssist: root.aiAssist
    }
  }

  onRefreshIntervalSecChanged: pushSettings()
  onShowStoppedChanged: pushSettings()
  onHideWhenEmptyChanged: pushSettings()
  onAiAssistChanged: pushSettings()

  Component.onCompleted: {
    pushSettings()
    MicrovmState.acquire("bar")
  }
  Component.onDestruction: {
    MicrovmState.release("bar")
    if (root.opened) MicrovmState.release("view")
  }

  onOpenedChanged: {
    if (opened) {
      MicrovmState.acquire("view")
      view.reset()
    } else {
      MicrovmState.release("view")
      view.dismiss()
    }
  }

  IpcHandler {
    target: root.ipcTarget

    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): void { MicrovmState.refresh() }
    function create(): void {
      root.open()
      view.openForm("disposable")
    }
    function status(): string { return MicrovmState.statusJson() }
  }

  // ------------------------------------------------------------------- bar

  implicitWidth: button.visible ? button.implicitWidth : 0
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: Model.Glyph.vm
    visible: !root.hideWhenEmpty || MicrovmState.counts.total > 0
    dimmed: MicrovmState.counts.running === 0
    active: MicrovmState.counts.running > 0 || MicrovmState.mutating
    useActiveColor: true
    activeColor: MicrovmState.counts.failing > 0 ? Color.urgent : Color.accent
    tooltipText: "MicroVMs · " + Model.summaryText(MicrovmState.allRows, MicrovmState.reachable)

    onPressed: function(b) {
      if (b === Qt.MiddleButton) MicrovmState.refresh()
      else root.toggle()
    }
  }

  // ----------------------------------------------------------------- panel

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: view.keyTarget
    // A fraction of what this screen offers, floored and capped in Style.space
    // units so the desktop text size still moves it. fittedContentWidth's cap
    // argument has always existed and was never passed.
    contentWidth: panel.fittedContentWidth(
      Model.cardWidth(panel.availableCardWidth, 0.30, Style.space(380), Style.space(620)),
      Style.space(620))
    contentHeight: panel.fittedContentHeight(view.implicitHeight)

    MicrovmView {
      id: view
      anchors.fill: parent
      foreground: root.foreground
      fontFamily: root.fontFamily
      onCloseRequested: root.close()
      onSwitchPanelRequested: function(direction) { root.switchPanel(direction) }
    }
  }
}
