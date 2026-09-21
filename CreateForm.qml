import QtQuick
import QtQuick.Controls
import qs.Ui
import qs.Commons
import "Model.js" as Model

// The create and edit form, both kinds. Keyboard only, the way nixarchy-pkg's
// OptionForm works: this scope owns the keyboard while it is open.
//
// Navigation is one function, navKey(), which every field forwards to. A text
// field keeps every printable key for itself (j and k included); Tab, the
// arrows, Enter and Esc mean the same thing everywhere.
//
// No Popup anywhere: the template and key pickers are inline lists under
// their field. A Popup is reparented to the overlay and would ignore the
// menu's scale.
FocusScope {
  id: root

  property var rows: []
  property var templates: []
  property var sshKeys: []
  // MicrovmState.featureState: decides whether the describe field exists.
  property var features: ({})
  property string hostHome: ""
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  readonly property color dim: Qt.darker(foreground, 1.5)

  // A disposable form is created straight away; a permanent one goes to the
  // review first, which is the view's to draw.
  signal submitted(var form)
  signal reviewRequested(var form)
  signal canceled()
  // Enter on the describe field.
  signal describeRequested(string text)
  signal cancelAgentRequested()

  // ------------------------------------------------------------------ state

  property var form: Model.emptyForm("disposable")
  property int fieldIndex: 0
  // Errors show once a field has been left, or after Enter was tried.
  property var touched: ({})
  property bool attempted: false
  // -1: the field itself; 0..n: a row of the inline list under it.
  property int listIndex: -1
  // Bumped whenever the form is replaced from outside (an edit, the agent):
  // every text field rebinds its text from the form, so what is shown is
  // what is validated and what is written.
  property int formVersion: 0
  // What the agent said, drawn under the describe field.
  property string reasoning: ""
  property bool thinking: false
  property string agentError: ""

  readonly property var fields: Model.visibleFields(form, features)
  readonly property var current: fieldIndex >= 0 && fieldIndex < fields.length ? fields[fieldIndex] : null
  readonly property var check: Model.validateForm(form, rows, templates, hostHome)
  // A new permanent VM on a services.nix without the microvm row (#6).
  readonly property string blocked: Model.permanentBlocked(form, features)
  readonly property var templateChoices: Model.templatesMatching(templates, form.template).slice(0, 6)
  readonly property var keyChoices: keysMatching(form.sshKey).slice(0, 6)
  readonly property string title: form.editing ? "Edit " + form.name : "New VM"

  implicitHeight: formColumn.implicitHeight

  function keysMatching(typed) {
    var q = String(typed || "").toLowerCase()
    var out = []
    for (var i = 0; i < root.sshKeys.length; i++) {
      var k = root.sshKeys[i]
      if (!q || q === k.key.toLowerCase() || (k.file + " " + k.key).toLowerCase().indexOf(q) !== -1) out.push(k)
    }
    return out
  }

  // Called every time the form opens: a clean form, cursor on the first field.
  function start(kind) {
    root.setForm(Model.emptyForm(kind))
    root.reasoning = ""
    root.begin()
  }

  function startEdit(row) {
    root.setForm(Model.formFromRow(row))
    root.reasoning = ""
    root.begin()
  }

  function begin() {
    root.touched = ({})
    root.attempted = false
    root.listIndex = -1
    root.fieldIndex = 0
    Qt.callLater(root.focusCurrent)
  }

  // The whole form at once (open, edit, or the agent's proposal).
  function setForm(next) {
    root.form = next
    root.formVersion += 1
  }

  function setValue(key, value) {
    var next = Object.assign({}, root.form)
    next[key] = value
    root.form = next
  }

  function showError(key) {
    return (root.attempted || root.touched[key] === true) && root.check.errors[key] ? root.check.errors[key] : ""
  }

  // Not root.forceActiveFocus() for a switch row: on a FocusScope that hands
  // focus back to the child that had it last, which is the text field just
  // left, and the next space would be typed into it. The sink holds the
  // keyboard instead; its keys bubble up to the handler below.
  function focusCurrent() {
    var item = fieldRepeater.itemAt(root.fieldIndex)
    if (item && item.takesText) item.takeFocus()
    else keySink.forceActiveFocus()
    if (item) flick.ensureVisible(item)
  }

  function moveField(delta) {
    if (root.current) {
      var t = Object.assign({}, root.touched)
      t[root.current.key] = true
      root.touched = t
    }
    root.listIndex = -1
    root.fieldIndex = Math.max(0, Math.min(root.fields.length - 1, root.fieldIndex + delta))
    Qt.callLater(root.focusCurrent)
  }

  function activate() {
    var f = root.current
    if (!f) return
    if (f.widget === "bool") setValue(f.key, !root.form[f.key])
    else if (f.widget === "kind") setValue("kind", root.form.kind === "permanent" ? "disposable" : "permanent")
  }

  function submit() {
    root.attempted = true
    if (!root.check.ok) {
      var at = Model.firstErrorIndex(root.fields, root.check.errors)
      if (at !== -1) root.fieldIndex = at
      Qt.callLater(root.focusCurrent)
      return
    }
    if (root.blocked) {
      for (var i = 0; i < root.fields.length; i++) if (root.fields[i].widget === "kind") root.fieldIndex = i
      Qt.callLater(root.focusCurrent)
      return
    }
    var f = Object.assign({}, root.form)
    if (f.kind === "permanent") root.reviewRequested(f)
    else root.submitted(f)
  }

  function choices() {
    var f = root.current
    if (!f) return []
    if (f.widget === "template") return root.templateChoices
    if (f.widget === "key") return root.keyChoices
    return []
  }

  function pick(index) {
    var list = root.choices()
    if (index < 0 || index >= list.length) return
    var f = root.current
    var value = f.widget === "template" ? list[index].name : list[index].key
    setValue(f.key, value)
    root.listIndex = -1
    var item = fieldRepeater.itemAt(root.fieldIndex)
    if (item && item.takesText) item.setText(value)
  }

  // The one place a navigation key is decided. Returns true when handled.
  function navKey(event) {
    var key = event.key
    var hasList = root.choices().length > 0
    var shift = (event.modifiers & Qt.ShiftModifier) !== 0

    if (key === Qt.Key_Escape) {
      if (root.thinking) root.cancelAgentRequested()
      else if (hasList && root.listIndex >= 0) root.listIndex = -1
      else root.canceled()
      return true
    }
    if (key === Qt.Key_Tab && !shift) { moveField(1); return true }
    if (key === Qt.Key_Backtab || (key === Qt.Key_Tab && shift)) { moveField(-1); return true }
    if (key === Qt.Key_Down) {
      if (hasList && root.listIndex < root.choices().length - 1) { root.listIndex += 1; return true }
      moveField(1)
      return true
    }
    if (key === Qt.Key_Up) {
      if (hasList && root.listIndex >= 0) { root.listIndex -= 1; return true }
      moveField(-1)
      return true
    }
    if (key === Qt.Key_Return || key === Qt.Key_Enter) {
      if (hasList && root.listIndex >= 0) { pick(root.listIndex); return true }
      if (root.current && root.current.key === "describe") {
        if (!root.thinking) root.describeRequested(String(root.form.describe || ""))
        return true
      }
      submit()
      return true
    }
    return false
  }

  // Keys that reach the scope itself: every row that is not a text field.
  Keys.onPressed: function(event) {
    if (root.navKey(event)) { event.accepted = true; return }
    if (event.key === Qt.Key_Space) { root.activate(); event.accepted = true; return }
    if (event.key === Qt.Key_J) { root.moveField(1); event.accepted = true; return }
    if (event.key === Qt.Key_K) { root.moveField(-1); event.accepted = true; return }
  }

  Item { id: keySink }

  Column {
    id: formColumn
    anchors.fill: parent
    spacing: Style.spacing.md

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: root.form.editing ? Model.Glyph.edit : Model.Glyph.plus
        textFormat: Text.PlainText
        color: Color.accent
        font.family: root.fontFamily
        font.pixelSize: Style.font.iconSmall
      }

      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: root.title
        textFormat: Text.PlainText
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        font.bold: true
      }

      // Why there is no describe field, when there is none.
      Text {
        anchors.verticalCenter: parent.verticalCenter
        visible: !root.form.editing && !(root.features.agent && root.features.aiAssist !== false)
        text: root.features.aiAssist === false ? "AI assist is off in the widget's settings"
          : "AI assist: needs claude as the default agent (codex is a follow-up)"
        textFormat: Text.PlainText
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        elide: Text.ElideRight
        width: Math.min(implicitWidth, formColumn.width - Style.space(120))
      }
    }

    Flickable {
      id: flick
      width: parent.width
      height: Math.min(fieldsColumn.implicitHeight, Style.space(400))
      contentHeight: fieldsColumn.implicitHeight
      clip: true
      boundsBehavior: Flickable.StopAtBounds

      ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

      function ensureVisible(item) {
        var y = item.mapToItem(fieldsColumn, 0, 0).y
        if (y < contentY) contentY = y
        else if (y + item.height > contentY + height) contentY = y + item.height - height
      }

      Column {
        id: fieldsColumn
        width: flick.width - Style.spacing.md
        spacing: Style.spacing.xs

        Repeater {
          id: fieldRepeater
          model: root.fields

          delegate: Item {
            id: fieldItem

            required property var modelData
            required property int index

            readonly property bool isCurrent: index === root.fieldIndex
            readonly property bool takesText: modelData.widget === "text" || modelData.widget === "template" || modelData.widget === "key"
            readonly property bool inert: modelData.key === "describe" && root.thinking
            readonly property string error: root.showError(modelData.key)
            readonly property string warning: root.check.warnings[modelData.key] || ""
            readonly property var listItems: fieldItem.isCurrent ? root.choices() : []
            // Rebind the text whenever the form is replaced from outside.
            readonly property int version: root.formVersion
            onVersionChanged: if (takesText) input.text = String(root.form[modelData.key] || "")

            function takeFocus() { input.forceActiveFocus() }
            function setText(value) { input.text = value }

            width: fieldsColumn.width
            implicitHeight: body.implicitHeight + Style.spacing.sm * 2
            opacity: inert ? 0.45 : 1.0

            CursorSurface {
              anchors.fill: parent
              hasCursor: fieldItem.isCurrent
              foreground: root.foreground
            }

            MouseArea {
              anchors.fill: parent
              onClicked: {
                root.fieldIndex = fieldItem.index
                root.activate()
                Qt.callLater(root.focusCurrent)
              }
            }

            Column {
              id: body
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              anchors.leftMargin: Style.spacing.lg
              anchors.rightMargin: Style.spacing.lg
              spacing: Style.spacing.xs

              // bool / kind: one line with a state glyph.
              Row {
                visible: !fieldItem.takesText
                width: parent.width
                spacing: Style.spacing.md

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  text: fieldItem.modelData.widget === "kind" ? "⇄" : (root.form[fieldItem.modelData.key] === true ? "■" : "□")
                  textFormat: Text.PlainText
                  color: fieldItem.modelData.widget === "bool" && root.form[fieldItem.modelData.key] === true
                    ? Color.accent : root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                }

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  text: fieldItem.modelData.widget === "kind"
                    ? fieldItem.modelData.label + ":  " + root.form.kind + (root.form.kind === "permanent" ? "   (boots with the host, one line in apps.nix)" : "   (no root, no rebuild)")
                    : fieldItem.modelData.label
                  textFormat: Text.PlainText
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  elide: Text.ElideRight
                  width: Math.min(implicitWidth, body.width - Style.space(24))
                }
              }

              Text {
                visible: fieldItem.modelData.widget === "kind" && root.blocked !== ""
                width: parent.width
                text: root.blocked
                textFormat: Text.PlainText
                color: Color.urgent
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                wrapMode: Text.WordWrap
              }

              // text / template / key: a label over a field.
              Text {
                visible: fieldItem.takesText
                text: fieldItem.modelData.label
                textFormat: Text.PlainText
                color: fieldItem.isCurrent ? root.foreground : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }

              TextField {
                id: input
                visible: fieldItem.takesText
                width: parent.width
                enabled: !fieldItem.inert
                foreground: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                placeholderText: fieldItem.modelData.hint || ""
                Component.onCompleted: if (fieldItem.takesText) text = String(root.form[fieldItem.modelData.key] || "")
                onTextEdited: {
                  root.listIndex = -1
                  root.setValue(fieldItem.modelData.key, text)
                }
                onActiveFocusChanged: if (activeFocus && root.fieldIndex !== fieldItem.index) root.fieldIndex = fieldItem.index
                Keys.onPressed: function(event) {
                  if (root.navKey(event)) event.accepted = true
                }
              }

              // The templates or the keys, filtered by what has been typed.
              Column {
                visible: fieldItem.listItems.length > 0
                width: parent.width
                spacing: 0

                Repeater {
                  model: fieldItem.listItems

                  delegate: Text {
                    required property var modelData
                    required property int index
                    width: parent ? parent.width : 0
                    text: (index === root.listIndex ? "›  " : "   ") +
                      (modelData.name !== undefined ? modelData.name + "   " + modelData.label + " — " + modelData.note
                        : modelData.file + "   " + modelData.key)
                    textFormat: Text.PlainText
                    color: index === root.listIndex ? Color.accent : root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    elide: Text.ElideRight

                    MouseArea {
                      anchors.fill: parent
                      onClicked: root.pick(parent.index)
                    }
                  }
                }
              }

              // Under describe: the agent's state and its reasoning.
              Text {
                visible: fieldItem.modelData.key === "describe" && text !== ""
                width: parent.width
                text: root.thinking ? "asking " + (root.features.agent || "the agent") + "…   esc cancels"
                  : (root.agentError !== "" ? root.agentError : root.reasoning)
                textFormat: Text.PlainText
                color: root.agentError !== "" && !root.thinking ? Color.urgent : (root.thinking ? Color.accent : root.dim)
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                wrapMode: Text.WordWrap
              }

              Text {
                visible: text !== ""
                width: parent.width
                text: fieldItem.error !== "" ? fieldItem.error
                  : (fieldItem.isCurrent && fieldItem.warning !== "" ? fieldItem.warning
                  : (fieldItem.isCurrent && !fieldItem.takesText && fieldItem.modelData.hint ? fieldItem.modelData.hint : ""))
                textFormat: Text.PlainText
                color: fieldItem.error !== "" ? Color.urgent : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                wrapMode: Text.WordWrap
              }
            }
          }
        }
      }
    }

    Text {
      width: parent.width
      horizontalAlignment: Text.AlignRight
      text: {
        var f = root.current
        var move = "tab/↓ next   "
        var go = root.form.kind === "permanent" ? "enter review" : (root.form.editing ? "enter save" : "enter create")
        if (!f) return ""
        if (f.key === "describe") return "enter ask the agent   tab skip   esc cancel"
        if (f.widget === "template" || f.widget === "key") return (root.listIndex >= 0 ? "enter pick   " : "↓ list   ") + "tab next   esc cancel"
        if (f.widget === "bool") return move + "space toggle   " + go + "   esc cancel"
        if (f.widget === "kind") return move + "space flip   esc cancel"
        return move + go + "   esc cancel"
      }
      textFormat: Text.PlainText
      color: root.foreground
      opacity: 0.65
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }
}
