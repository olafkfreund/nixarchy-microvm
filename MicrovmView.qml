import QtQuick
import QtQuick.Controls
import Quickshell
import qs.Ui
import qs.Commons
import "Model.js" as Model

// Everything you can press: the list, the filter, the questions, and the
// form, the review and the log once they are open. It draws the MicrovmState
// singleton, so the bar popup and the full-screen menu share every key.
FocusScope {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  readonly property color dim: Qt.darker(foreground, 1.5)

  // KeyboardPanel focuses this directly: handing it the FocusScope instead
  // would restore whichever child held focus last, stale filter field included.
  readonly property alias keyTarget: keyCatcher

  implicitHeight: column.implicitHeight

  signal closeRequested()
  signal switchPanelRequested(int direction)

  // ------------------------------------------------------------------ state

  // list | form | review | log. The form, the review and the log own the
  // keyboard while open.
  property string mode: "list"

  property string filterText: ""

  property var confirmAction: null
  property string confirmMessage: ""
  property string confirmLabel: "Delete"
  property bool confirmOpen: false
  property bool helpOpen: false

  property int cursorIndex: 0
  // The cursor's identity. cursorIndex is a cache of where this key currently
  // sits, so a list that re-sorts under the user moves the cursor with the
  // machine instead of leaving it on a slot (#21).
  property string cursorKey: ""
  property bool cursorActive: false
  property bool cursorFromKeyboard: false

  // ------------------------------------------------------------- derivation

  readonly property var rows: Model.filterRows(MicrovmState.rows, filterText)
  readonly property var cursorRow: Model.rowByKey(rows, cursorKey)
  readonly property var features: MicrovmState.featureState
  readonly property var listActions: Model.listActions(features, MicrovmState.counts)

  onRowsChanged: {
    var c = Model.resolveCursor(rows, root.cursorKey, root.cursorIndex)
    root.cursorKey = c.key
    root.cursorIndex = c.index
  }

  // ------------------------------------------------------------ lifecycle

  // Called every time the surface opens: fresh cursor, empty filter, back to
  // the list. Never touches the stream or its log: a build in flight
  // survives any number of closes.
  function reset() {
    mode = "list"
    cursorActive = false
    cursorIndex = 0
    cursorKey = ""
    filterText = ""
    filterField.text = ""
    filterField.focus = false
    MicrovmState.lastError = ""
    helpOpen = false
    closeConfirm()
    Qt.callLater(root.focusForMode)
  }

  // Deferred, and decided by the mode at the time it runs, so an open that
  // lands straight in the form (IPC create) keeps the form's focus.
  function focusForMode() {
    if (root.mode === "log") logView.forceActiveFocus()
    else if (root.mode === "form") createForm.focusCurrent()
    else if (root.mode === "review") review.forceActiveFocus()
    else keyCatcher.forceActiveFocus()
  }

  // c, IPC create, or the menu's {"create":true}.
  function openForm(kind) {
    root.mode = "form"
    root.helpOpen = false
    // The form binds this; clearing it there would break the binding (#7).
    MicrovmState.agentError = ""
    createForm.start(kind || "disposable")
  }

  // m on a row: the template of a disposable VM, every field of a
  // permanent one.
  function openEdit(row) {
    root.mode = "form"
    root.helpOpen = false
    // The form binds this; clearing it there would break the binding (#7).
    MicrovmState.agentError = ""
    createForm.startEdit(row)
  }

  // A permanent form, valid: show the exact line and the commands first.
  property var reviewForm: null
  readonly property string reviewSnippet: reviewForm ? (Model.machineSnippet(reviewForm, MicrovmState.allRows, MicrovmState.templates, MicrovmState.home) || "") : ""
  readonly property var reviewArgvs: reviewForm ? (Model.submitArgvs(reviewForm, MicrovmState.allRows, MicrovmState.templates, MicrovmState.home, root.features) || []) : []

  function openReview(form) {
    root.reviewForm = form
    setMode("review")
  }

  function submitForm(form) {
    root.reviewForm = null
    MicrovmState.submit(form)
    setMode("list")
  }

  // o: back to whatever the last build printed. Nothing to show until a
  // detached run has streamed (nixarchy#762).
  function openLog() {
    if (MicrovmState.log.length === 0) return
    setMode("log")
  }

  function setMode(next) {
    root.mode = next
    root.helpOpen = false
    Qt.callLater(root.focusForMode)
  }

  // Called when the surface closes.
  function dismiss() {
    helpOpen = false
    closeConfirm()
  }

  // --------------------------------------------------------------- actions

  // Every row button and key ends up here, so this is the one place a verb
  // turns into something that happens. The singleton asks actionsFor again
  // before running anything, so a stale button cannot slip past.
  function dispatch(key, verb) {
    var row = Model.rowByKey(MicrovmState.allRows, key)
    if (!row) return
    if (verb === "console") { if (MicrovmState.console_(row)) root.closeRequested(); return }
    if (verb === "startTerminal") { if (MicrovmState.startTerminal(row)) root.closeRequested(); return }
    if (verb === "logs") { if (MicrovmState.logs(row)) root.closeRequested(); return }
    if (verb === "copy") { MicrovmState.copyName(row.name); return }
    if (verb === "remove") { askRemove(row); return }
    if (verb === "edit") { if (Model.actionFor(row, root.features, "edit")) openEdit(row); return }
    if (verb === "start") { if (MicrovmState.start(row) && row.kind === "disposable") setMode("log") }
    else if (verb === "stop") MicrovmState.stop(row)
    else if (verb === "restart") MicrovmState.restart(row)
  }

  function keyAtCursor(key) {
    if (!cursorActive || !cursorRow) return
    var verb = Model.verbForKey(cursorRow, root.features, key)
    if (verb) dispatch(cursorRow.key, verb)
  }

  function apply() {
    if (MicrovmState.apply()) root.closeRequested()
  }

  // ---------------------------------------------------------- confirmation

  function ask(action, message, label) {
    root.confirmAction = action
    root.confirmMessage = message
    root.confirmLabel = label
    // Cancel is the default answer to every question asked here. The shell's
    // ConfirmDialog would otherwise default to its confirm button.
    confirmDialog.selectedIndex = 0
    root.confirmOpen = true
  }

  function askRemove(row) {
    if (!Model.actionFor(row, root.features, "remove")) return
    if (MicrovmState.mutating) { MicrovmState.lastError = MicrovmState.busyText(); return }
    var key = row.key
    ask(function() {
      var r = Model.rowByKey(MicrovmState.allRows, key)
      if (r) MicrovmState.remove(r)
    }, Model.removeMessage(row, MicrovmState.vmStateDir), row.kind === "permanent" ? "Remove" : "Delete")
  }

  function closeConfirm() {
    root.confirmOpen = false
    root.confirmAction = null
  }

  function confirmAccepted() {
    var action = root.confirmAction
    closeConfirm()
    if (action) action()
  }

  // -------------------------------------------------------------- keyboard

  // Up from the first row lands in the filter, the mirror of the Down key
  // that walks out of it; the first Down lands on the first row
  // (Model.stepCursor).
  function moveCursor(delta) {
    var next = Model.stepCursor(cursorActive, cursorIndex, delta, rows.length)
    if (next.toFilter) {
      filterField.forceActiveFocus()
      cursorActive = false
      return
    }
    cursorActive = true
    cursorFromKeyboard = true
    cursorIndex = next.index
    cursorKey = next.index >= 0 && next.index < rows.length ? rows[next.index].key : ""
  }

  function setCursor(index) {
    cursorActive = true
    cursorFromKeyboard = false
    cursorIndex = Model.clampCursor(index, rows.length)
  }

  function handleTextKey(key) {
    if (key === "?") { root.helpOpen = !root.helpOpen; return }
    if (root.helpOpen) { root.helpOpen = false; return }
    if (key === "/") { filterField.forceActiveFocus(); return }
    if (key === "u") { MicrovmState.refresh(); return }
    if (key === "a") { if (root.listActions.apply) apply(); return }
    if (key === "o") { openLog(); return }
    if (key === "c") { openForm("disposable"); return }
    if (key === "i") { if (root.listActions.assist) openForm("disposable"); return }
    // Row keys: only what actionsFor lists for the row under the cursor.
    if ("esrlmxy".indexOf(key) !== -1 && key.length === 1) keyAtCursor(key === "e" ? "enter" : key)
  }

  // The hint under the list: why the obvious key is not there for this row.
  readonly property string hintText: {
    if (!cursorActive || !cursorRow) return ""
    var why = Model.hiddenReason(cursorRow, root.features, "console")
    if (why) return "enter: " + why
    why = Model.hiddenReason(cursorRow, root.features, "edit")
    if (why) return "m: " + why
    return ""
  }

  // ----------------------------------------------------------------- view

  // The confirmation lives outside PanelKeyCatcher on purpose: the catcher
  // goes `blocked` while a question is open, so the unhandled key bubbles
  // out to here and the dialog answers it.
  Item {
    id: keyRoot
    anchors.fill: parent

    Keys.onPressed: function(event) {
      if (!root.confirmOpen) return
      if (confirmDialog.handleKey(event)) event.accepted = true
    }

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: filterField.activeFocus || root.confirmOpen || root.mode !== "list"

      onActiveFocusChanged: if (activeFocus && root.mode !== "list") Qt.callLater(root.focusForMode)

      onMoveRequested: function(dx, dy) {
        if (root.helpOpen) { if (dy !== 0) helpSheet.scroll(dy); return }
        if (dy !== 0) root.moveCursor(dy)
      }
      onActivateRequested: {
        if (root.helpOpen) root.helpOpen = false
        else root.keyAtCursor("enter")
      }
      onDeleteRequested: if (!root.helpOpen && root.cursorActive && root.cursorRow) root.askRemove(root.cursorRow)
      onCloseRequested: {
        if (root.helpOpen) root.helpOpen = false
        else root.closeRequested()
      }
      onTabRequested: function(direction) { root.switchPanelRequested(direction) }
      onTextKey: function(text) { root.handleTextKey(text) }

      Column {
        id: column
        anchors.fill: parent
        spacing: Style.spacing.panelGap

        PanelHero {
          title: "MicroVMs"
          meta: Model.summaryText(MicrovmState.allRows, MicrovmState.reachable)
          foreground: root.foreground
          fontFamily: root.fontFamily
          iconOpacity: MicrovmState.counts.running > 0 ? 1.0 : 0.5

          iconComponent: Text {
            text: Model.Glyph.vm
            color: MicrovmState.counts.failing > 0 ? Color.urgent : root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.display
          }

          trailingControl: Row {
            spacing: Style.spacing.sm

            PanelActionButton {
              iconText: Model.Glyph.keyboard
              tooltipText: "Keyboard shortcuts  (?)"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.helpOpen = !root.helpOpen
            }

            PanelActionButton {
              iconText: Model.Glyph.refresh
              tooltipText: "Refresh  (u)"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: MicrovmState.refresh()

              RotationAnimation on rotation {
                running: MicrovmState.loading
                from: 0
                to: 360
                duration: 900
                loops: Animation.Infinite
                onRunningChanged: if (!running) rotation = 0
              }
            }

            PanelActionButton {
              visible: root.listActions.apply
              iconText: Model.Glyph.apply
              tooltipText: "Apply queued changes: nixarchy-apply in a terminal  (a)"
              foreground: root.foreground
              hoverColor: Color.accent
              fontFamily: root.fontFamily
              onClicked: root.apply()
            }
          }
        }

        CreateForm {
          id: createForm
          visible: root.mode === "form"
          width: parent.width
          height: visible ? implicitHeight : 0
          rows: MicrovmState.allRows
          templates: MicrovmState.templates
          sshKeys: MicrovmState.sshKeys
          features: root.features
          hostHome: MicrovmState.home
          foreground: root.foreground
          fontFamily: root.fontFamily
          thinking: MicrovmState.thinking
          agentError: MicrovmState.agentError
          onSubmitted: function(form) { root.submitForm(form) }
          onReviewRequested: function(form) { root.openReview(form) }
          onCanceled: root.setMode("list")
          onDescribeRequested: function(text) { MicrovmState.askAgent(text) }
          onCancelAgentRequested: MicrovmState.cancelAgent()

          // The agent's proposal, once it arrives: converted per field,
          // dropped into the form, and validated as if typed. The user
          // still Tabs through it and presses Enter.
          Connections {
            target: MicrovmState
            function onAgentFormChanged() {
              if (!MicrovmState.agentForm || root.mode !== "form") return
              var got = Model.applyAgentReply(MicrovmState.agentForm, createForm.form)
              createForm.setForm(got.form)
              createForm.reasoning = got.reasoning
              if (got.rejected.length > 0) MicrovmState.agentError = "ignored (wrong type): " + got.rejected.join(", ")
              createForm.attempted = true
              Qt.callLater(createForm.focusCurrent)
            }
          }
        }

        // The review: what a permanent VM's line will be, and what runs.
        FocusScope {
          id: review
          visible: root.mode === "review"
          width: parent.width
          height: visible ? implicitHeight : 0
          implicitHeight: reviewColumn.implicitHeight

          Keys.onPressed: function(event) {
            if (event.key === Qt.Key_Escape) { root.setMode("form"); Qt.callLater(createForm.focusCurrent); event.accepted = true }
            else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) { root.submitForm(root.reviewForm); event.accepted = true }
          }

          Column {
            id: reviewColumn
            width: parent.width
            spacing: Style.spacing.md

            Text {
              width: parent.width
              text: root.reviewForm ? Model.formSummary(root.reviewForm) : ""
              textFormat: Text.PlainText
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              font.bold: true
            }

            Text {
              width: parent.width
              text: "This line goes into ~/.config/nixarchy/apps.nix:"
              textFormat: Text.PlainText
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }

            Text {
              width: parent.width
              text: root.reviewForm ? Model.optPath(root.reviewForm.name) + " = " + root.reviewSnippet + ";" : ""
              textFormat: Text.PlainText
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WrapAnywhere
            }

            Text {
              width: parent.width
              readonly property string blocked: root.reviewForm ? Model.permanentBlocked(root.reviewForm, root.features) : ""
              text: blocked !== "" ? blocked
                : "Runs: " + root.reviewArgvs.map(function(a) { return a.slice(0, 4).map(function(x) { return x.indexOf("/") === 0 ? "nixarchy-pkg" : x }).join(" ") }).join(", then ")
              textFormat: Text.PlainText
              color: blocked !== "" ? Color.urgent : root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
            }

            Text {
              width: parent.width
              text: "Nothing is built yet. Apply (a) rebuilds the whole system from apps.nix, services.nix and advanced.nix, not only this line. To add modules beyond an SSH key, edit the line in apps.nix afterwards."
              textFormat: Text.PlainText
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
            }

            Text {
              width: parent.width
              horizontalAlignment: Text.AlignRight
              text: "enter write it   esc back to the form"
              textFormat: Text.PlainText
              color: root.foreground
              opacity: 0.65
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }
        }

        LogView {
          id: logView
          visible: root.mode === "log"
          width: parent.width
          height: visible ? implicitHeight : 0
          lines: MicrovmState.log
          title: MicrovmState.streamTitle
          running: MicrovmState.streaming
          exitCode: MicrovmState.streamExit
          foreground: root.foreground
          fontFamily: root.fontFamily
          onBackRequested: root.setMode("list")
        }

        TextField {
          id: filterField
          visible: root.mode === "list"
          width: parent.width
          foreground: root.foreground
          // The operator stays on the first line: a line that ends on a
          // complete expression gets a semicolon inserted for it, and the
          // rest of the binding is quietly dropped.
          placeholderText: Model.Glyph.search + "  Filter VMs" +
            (activeFocus ? "" : "   /")
          onTextChanged: {
            root.filterText = text
            root.cursorIndex = 0
            root.cursorKey = ""
          }
          Keys.onEscapePressed: {
            if (text.length > 0) text = ""
            else keyCatcher.forceActiveFocus()
          }
          Keys.onDownPressed: {
            keyCatcher.forceActiveFocus()
            root.moveCursor(0)
          }
        }

        VmList {
          id: list
          visible: root.mode === "list"
          width: parent.width
          rows: root.rows
          features: root.features
          pendingKey: MicrovmState.pendingKey
          pendingVerb: MicrovmState.pendingVerb
          cursorIndex: root.cursorIndex
          cursorActive: root.cursorActive
          cursorFromKeyboard: root.cursorFromKeyboard
          foreground: root.foreground
          fontFamily: root.fontFamily

          onActionRequested: function(key, verb) { root.dispatch(key, verb) }
          onCursorRequested: function(index) { root.setCursor(index) }
        }

        Column {
          visible: root.mode === "list" && list.count === 0
          width: parent.width
          spacing: Style.spacing.sm
          topPadding: Style.spacing.lg
          bottomPadding: Style.spacing.lg

          Text {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: Model.emptyText({
              everLoaded: MicrovmState.everLoaded,
              reachable: MicrovmState.reachable,
              filtered: MicrovmState.rows.length > 0,
              showStopped: MicrovmState.showStopped
            })
            textFormat: Text.PlainText
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.WordWrap
          }
        }

        // ------------------------------------------------------------ footer
        //
        // nixarchy-pkg's shape: a hairline, then one line for whatever went
        // wrong or is running, then counts on the left and keys on the right.

        Rectangle {
          width: parent.width
          height: Math.max(1, Style.space(1))
          color: root.dim
          opacity: 0.25
        }

        Item {
          width: parent.width
          visible: MicrovmState.lastError !== ""
          implicitHeight: visible ? Math.max(errorText.implicitHeight, errorDismiss.height) : 0
          height: implicitHeight

          Text {
            id: errorGlyph
            anchors.left: parent.left
            anchors.top: parent.top
            text: Model.Glyph.alert
            textFormat: Text.PlainText
            color: Color.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.iconSmall
          }

          Text {
            id: errorText
            anchors.left: errorGlyph.right
            anchors.leftMargin: Style.spacing.md
            anchors.right: errorDismiss.left
            anchors.rightMargin: Style.spacing.md
            anchors.top: parent.top
            text: MicrovmState.lastError
            textFormat: Text.PlainText
            color: Color.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
          }

          PanelActionButton {
            id: errorDismiss
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.topMargin: -Style.spacing.xs
            iconText: Model.Glyph.close
            tooltipText: "Dismiss"
            foreground: root.foreground
            fontFamily: root.fontFamily
            fontSize: Style.font.iconSmall
            size: Style.space(20)
            onClicked: MicrovmState.lastError = ""
          }
        }

        // The stream, a queued apply, a terminal notice, or why a key is
        // missing for the row under the cursor. One line, the first that
        // has something to say.
        Text {
          width: parent.width
          visible: text !== "" && MicrovmState.lastError === "" && root.mode === "list"
          text: {
            if (MicrovmState.streaming) return MicrovmState.streamTitle + " …   o to watch"
            if (MicrovmState.streamExit >= 0) {
              return MicrovmState.streamTitle + (MicrovmState.streamExit === 0 ? " finished" : " failed") + "   o shows the log"
            }
            if (MicrovmState.notice !== "") return MicrovmState.notice
            if (root.listActions.apply) return "queued for the next rebuild · a applies now (nixarchy-apply, in a terminal)"
            return root.hintText
          }
          textFormat: Text.PlainText
          color: MicrovmState.streaming || root.listActions.apply ? Color.accent : root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }

        Item {
          width: parent.width
          implicitHeight: countsText.implicitHeight
          height: implicitHeight

          Text {
            id: countsText
            anchors.left: parent.left
            anchors.right: keysText.left
            anchors.rightMargin: Style.spacing.md
            elide: Text.ElideRight
            text: Model.footerText(MicrovmState.allRows)
            textFormat: Text.PlainText
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }

          Text {
            id: keysText
            anchors.right: parent.right
            text: MicrovmState.mutating ? "working…"
              : "? keys   c create" + (root.listActions.assist ? "   i describe" : "") + (root.listActions.apply ? "   a apply" : "") + "   esc close"
            textFormat: Text.PlainText
            color: root.foreground
            opacity: 0.65
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }
    }

    ShortcutSheet {
      id: helpSheet
      anchors.fill: parent
      z: 5
      opened: root.helpOpen
      foreground: root.foreground
      background: Color.popups.background
      fontFamily: root.fontFamily
      onDismissed: root.helpOpen = false
    }

    ConfirmDialog {
      id: confirmDialog
      anchors.fill: parent
      z: 10
      opened: root.confirmOpen
      message: root.confirmMessage
      confirmText: root.confirmLabel
      background: Color.popups.background
      foreground: root.foreground
      fontFamily: root.fontFamily
      onCanceled: root.closeConfirm()
      onConfirmed: root.confirmAccepted()
    }
  }
}
