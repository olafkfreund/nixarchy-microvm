import QtQuick
import QtQuick.Controls
import qs.Ui
import qs.Commons
import qs.Commons as Commons
import "Model.js" as Model

// The list of VMs, both kinds. Rows come from Model.rowsFor; the ListModel is
// reconciled rather than reassigned, so a status changing under the cursor
// updates in place instead of rebuilding the delegate and dropping the hover
// state.
Item {
  id: root

  property var rows: []
  // MicrovmState.featureState: the lock and the detected features, which
  // decide the buttons a row shows.
  property var features: ({})
  property string pendingKey: ""
  property string pendingVerb: ""

  property int cursorIndex: 0
  property bool cursorActive: false
  property bool cursorFromKeyboard: false

  // Overview: the same rows as cards, with the readings MicrovmState takes.
  property bool cards: false
  property bool large: false
  property var stats: ({})
  property var history: ({})

  property color foreground: Commons.Color.foreground
  property string fontFamily: Style.font.family
  property var fontSize: ({ caption: Style.font.caption, body: Style.font.body, display: Style.font.display, iconSmall: Style.font.iconSmall, icon: Style.font.icon })

  readonly property color dim: Qt.darker(foreground, 1.5)
  readonly property int count: rowModel.count

  // Fixed from the font sizes: name, template, status, uptime/memory and
  // configured lines, then the CPU slot. One cell height serves the grid and
  // Model.cardsNaturalHeight, so nothing scrolls inside the body.
  readonly property int lineHeight: Math.ceil(fontSize.caption * 1.5)
  readonly property int cpuSlotHeight: Style.space(28)
  readonly property int cardHeight: Math.ceil(fontSize.body * 1.6) + 4 * lineHeight + cpuSlotHeight + Style.spacing.xxl
  readonly property int cellHeight: cardHeight + Style.spacing.md
  readonly property int columns: Model.cardColumns(width, Style.space(large ? 360 : 260))

  signal actionRequested(string key, string verb)
  signal cursorRequested(string key)

  // contentHeight, not the assigned height: the natural size must not be
  // derived from the size it is given, or the graph closes on itself.
  implicitHeight: cards ? Model.cardsNaturalHeight(rowModel.count, columns, cellHeight) : listView.contentHeight

  ListModel { id: rowModel }

  function sync() {
    var next = root.rows || []
    var keys = []
    for (var i = 0; i < rowModel.count; i++) keys.push(rowModel.get(i).key)

    var ops = Model.reconcilePlan(keys, next)
    for (var o = 0; o < ops.length; o++) {
      var op = ops[o]
      if (op.op === "remove") rowModel.remove(op.index)
      else if (op.op === "move") rowModel.move(op.from, op.to, 1)
      else rowModel.insert(op.index, Model.rowRecord(op.row))
    }

    for (var n = 0; n < next.length; n++) {
      var record = Model.rowRecord(next[n])
      var current = rowModel.get(n)
      for (var f = 0; f < Model.ROW_FIELDS.length; f++) {
        var field = Model.ROW_FIELDS[f]
        if (current[field] !== record[field]) rowModel.setProperty(n, field, record[field])
      }
    }
  }

  onRowsChanged: sync()
  Component.onCompleted: sync()

  ListView {
    id: listView

    width: parent.width
    height: root.height
    visible: !root.cards && rowModel.count > 0
    spacing: Style.spacing.sm
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    interactive: contentHeight > height

    ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

    model: rowModel
    currentIndex: root.cursorIndex

    onCurrentIndexChanged: {
      if (currentIndex >= 0 && root.cursorFromKeyboard) Qt.callLater(keepCurrentVisible)
    }
    function keepCurrentVisible() {
      if (currentIndex >= 0 && root.cursorFromKeyboard) positionViewAtIndex(currentIndex, ListView.Contain)
    }

    delegate: VmRow {
      required property var model
      required property int index

      width: ListView.view.width
      row: model
      rowIndex: index
    }
  }

  GridView {
    id: gridView

    width: parent.width
    height: root.height
    visible: root.cards && rowModel.count > 0
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    interactive: contentHeight > height
    cellWidth: Math.max(1, Math.floor(width / root.columns))
    cellHeight: root.cellHeight

    ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

    model: rowModel
    currentIndex: root.cursorIndex

    onCurrentIndexChanged: {
      if (currentIndex >= 0 && root.cursorFromKeyboard) Qt.callLater(keepCurrentVisible)
    }
    onVisibleChanged: if (visible) Qt.callLater(keepCurrentVisible)
    function keepCurrentVisible() {
      if (currentIndex >= 0 && root.cursorFromKeyboard) positionViewAtIndex(currentIndex, GridView.Contain)
    }

    delegate: Item {
      id: cell
      required property var model
      required property int index

      width: GridView.view.cellWidth
      height: GridView.view.cellHeight

      VmCard {
        x: Style.spacing.md / 2
        y: Style.spacing.md / 2
        width: parent.width - Style.spacing.md
        height: parent.height - Style.spacing.md
        row: cell.model
        rowIndex: cell.index
      }
    }
  }

  component ActionButtons: Row {
    id: buttons
    required property var row
    required property var actions
    spacing: Style.spacing.xxs

    Repeater {
      model: buttons.actions

      delegate: PanelActionButton {
        required property var modelData

        enabled: modelData.enabled
        opacity: modelData.enabled ? 1.0 : 0.4
        iconText: modelData.glyph
        tooltipText: modelData.tooltip
        foreground: root.foreground
        hoverColor: modelData.danger ? Commons.Color.urgent : root.foreground
        fontFamily: root.fontFamily
        fontSize: root.fontSize.iconSmall
        size: Style.space(22)
        onClicked: root.actionRequested(buttons.row.key, modelData.verb)
      }
    }
  }

  component VmCard: CursorSurface {
    id: card

    required property var row
    required property int rowIndex

    readonly property bool rowPending: root.pendingKey === card.row.key && root.pendingVerb !== ""
    readonly property var actions: Model.buttonsFor(card.row, root.features)
    readonly property string enterVerb: Model.verbForKey(card.row, root.features, "enter") || ""
    readonly property var info: Model.overviewCard(card.row, root.stats, root.history, Date.now())

    hasCursor: root.cursorActive && rowIndex === root.cursorIndex
    foreground: root.foreground
    opacity: card.rowPending ? 0.7 : 1.0

    MouseArea {
      id: cardMouse
      anchors.fill: parent
      hoverEnabled: true
      acceptedButtons: Qt.LeftButton
      cursorShape: card.enterVerb ? Qt.PointingHandCursor : Qt.ArrowCursor
      onContainsMouseChanged: if (containsMouse) root.cursorRequested(card.row.key)
      onClicked: if (card.enterVerb) root.actionRequested(card.row.key, card.enterVerb)
    }

    PanelToolTip {
      visible: cardMouse.containsMouse && card.enterVerb !== ""
      text: "Open the console of " + card.row.name + "  (enter)"
      fontFamily: root.fontFamily
    }

    ActionButtons {
      id: cardActions
      row: card.row
      actions: card.actions
      anchors.right: parent.right
      anchors.rightMargin: Style.spacing.md
      anchors.top: parent.top
      anchors.topMargin: Style.spacing.md
    }

    Column {
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.top: parent.top
      anchors.margins: Style.spacing.xl

      Row {
        width: parent.width - cardActions.width - Style.spacing.md
        height: Math.ceil(root.fontSize.body * 1.6)
        spacing: Style.spacing.md

        Text {
          text: card.row.name
          textFormat: Text.PlainText
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: root.fontSize.body
          font.bold: card.row.up
          elide: Text.ElideRight
          width: Math.max(0, Math.min(implicitWidth, parent.width - cardKind.width - Style.spacing.md))
        }

        Rectangle {
          id: cardKind
          anchors.verticalCenter: parent.verticalCenter
          width: cardKindText.implicitWidth + Style.spacing.md
          height: cardKindText.implicitHeight + Style.spacing.xxs
          radius: Style.space(3)
          color: "transparent"
          border.width: 1
          border.color: card.row.kind === "permanent" ? Commons.Color.accent : root.dim

          Text {
            id: cardKindText
            anchors.centerIn: parent
            text: card.row.kind
            textFormat: Text.PlainText
            color: card.row.kind === "permanent" ? Commons.Color.accent : root.dim
            font.family: root.fontFamily
            font.pixelSize: root.fontSize.caption
          }
        }
      }

      Text {
        width: parent.width
        height: root.lineHeight
        text: Model.join([card.row.template, Model.ownershipText(card.row)], " · ")
        textFormat: Text.PlainText
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: root.fontSize.caption
        elide: Text.ElideRight
      }

      Text {
        width: parent.width
        height: root.lineHeight
        text: card.rowPending ? root.pendingVerb + "…"
          : (card.row.up && !card.row.pending ? "" : card.row.status)
        textFormat: Text.PlainText
        color: card.rowPending || card.row.pending ? Commons.Color.accent
          : (card.row.failing ? Commons.Color.urgent : root.dim)
        font.family: root.fontFamily
        font.pixelSize: root.fontSize.caption
        elide: Text.ElideRight
      }

      Text {
        width: parent.width
        height: root.lineHeight
        text: card.info.running ? "up " + card.info.uptimeText + " · " + card.info.memText : ""
        textFormat: Text.PlainText
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: root.fontSize.caption
        elide: Text.ElideRight
      }

      Text {
        width: parent.width
        height: root.lineHeight
        text: card.info.configText
        textFormat: Text.PlainText
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: root.fontSize.caption
        elide: Text.ElideRight
      }
    }

    // Fixed height, so a trend appearing or going never moves the card.
    Item {
      id: cpuSlot
      visible: card.info.running
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.bottom: parent.bottom
      anchors.margins: Style.spacing.xl
      height: root.cpuSlotHeight

      Text {
        id: cpuLabel
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        text: "cpu " + card.info.cpuText
        textFormat: Text.PlainText
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: root.fontSize.caption
      }

      Canvas {
        id: spark
        anchors.left: parent.left
        anchors.right: cpuLabel.left
        anchors.rightMargin: Style.spacing.md
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        property var trend: card.info.cpuTrend
        onTrendChanged: requestPaint()
        onWidthChanged: requestPaint()
        onHeightChanged: requestPaint()
        onPaint: {
          var ctx = getContext("2d")
          ctx.clearRect(0, 0, width, height)
          var t = trend || []
          if (t.length < 2) return
          var top = 100
          for (var i = 0; i < t.length; i++) if (t[i] !== null && t[i] > top) top = t[i]
          ctx.strokeStyle = String(Commons.Color.accent)
          ctx.lineWidth = 1.5
          ctx.beginPath()
          var pen = false
          for (var j = 0; j < t.length; j++) {
            if (t[j] === null) { pen = false; continue }
            var x = j * width / (t.length - 1)
            var y = height - 1 - (height - 2) * t[j] / top
            if (pen) ctx.lineTo(x, y)
            else { ctx.moveTo(x, y); pen = true }
          }
          ctx.stroke()
        }
      }
    }
  }

  component VmRow: CursorSurface {
    id: rowSurface

    required property var row
    required property int rowIndex

    readonly property bool rowPending: root.pendingKey === rowSurface.row.key && root.pendingVerb !== ""
    readonly property var actions: Model.buttonsFor(rowSurface.row, root.features)
    // What Enter does on this row, for the click and the tooltip.
    readonly property string enterVerb: Model.verbForKey(rowSurface.row, root.features, "enter") || ""

    hasCursor: root.cursorActive && rowIndex === root.cursorIndex
    foreground: root.foreground
    implicitHeight: rowContent.implicitHeight + Style.spacing.xxl
    height: implicitHeight
    opacity: rowSurface.rowPending ? 0.7 : 1.0

    MouseArea {
      id: rowMouse
      anchors.fill: parent
      hoverEnabled: true
      acceptedButtons: Qt.LeftButton
      cursorShape: rowSurface.enterVerb ? Qt.PointingHandCursor : Qt.ArrowCursor
      onContainsMouseChanged: if (containsMouse) root.cursorRequested(rowSurface.row.key)
      onClicked: if (rowSurface.enterVerb) root.actionRequested(rowSurface.row.key, rowSurface.enterVerb)
    }

    PanelToolTip {
      visible: rowMouse.containsMouse && rowSurface.enterVerb !== ""
      text: "Open the console of " + rowSurface.row.name + "  (enter)"
      fontFamily: root.fontFamily
    }

    Item {
      id: rowContent
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.spacing.xl
      anchors.rightMargin: Style.spacing.xl
      implicitHeight: Math.max(identity.implicitHeight, rowActions.implicitHeight)

      Rectangle {
        id: stateDot
        width: Style.space(7)
        height: width
        radius: width / 2
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        color: rowSurface.row.failing ? Commons.Color.urgent
          : (rowSurface.row.up ? Commons.Color.accent : "transparent")
        border.width: !rowSurface.row.up && !rowSurface.row.failing ? 1 : 0
        border.color: root.dim

        SequentialAnimation on opacity {
          running: rowSurface.rowPending
          loops: Animation.Infinite
          NumberAnimation { to: 0.25; duration: 600; easing.type: Easing.InOutQuad }
          NumberAnimation { to: 1.0; duration: 600; easing.type: Easing.InOutQuad }
          onRunningChanged: if (!running) stateDot.opacity = 1
        }
      }

      Column {
        id: identity
        anchors.left: stateDot.right
        anchors.leftMargin: Style.spacing.xl
        anchors.right: rowActions.left
        anchors.rightMargin: Style.spacing.lg
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.spacing.xxs

        Row {
          width: parent.width
          spacing: Style.spacing.md

          Text {
            text: rowSurface.row.name
            textFormat: Text.PlainText
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: root.fontSize.body
            font.bold: rowSurface.row.up
            elide: Text.ElideRight
            width: Math.max(0, Math.min(implicitWidth, identity.width - kindBadge.width - Style.spacing.md))
          }

          // The kind, as a small badge: the one thing that tells the two
          // lists apart at a glance.
          Rectangle {
            id: kindBadge
            anchors.verticalCenter: parent.verticalCenter
            width: kindText.implicitWidth + Style.spacing.md
            height: kindText.implicitHeight + Style.spacing.xxs
            radius: Style.space(3)
            color: "transparent"
            border.width: 1
            border.color: rowSurface.row.kind === "permanent" ? Commons.Color.accent : root.dim

            Text {
              id: kindText
              anchors.centerIn: parent
              text: rowSurface.row.kind
              textFormat: Text.PlainText
              color: rowSurface.row.kind === "permanent" ? Commons.Color.accent : root.dim
              font.family: root.fontFamily
              font.pixelSize: root.fontSize.caption
            }
          }
        }

        Text {
          width: parent.width
          text: Model.join([rowSurface.row.template, Model.ownershipText(rowSurface.row)], " · ")
          textFormat: Text.PlainText
          visible: text !== ""
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: root.fontSize.caption
          elide: Text.ElideRight
        }

        Text {
          width: parent.width
          visible: text !== ""
          text: rowSurface.rowPending ? root.pendingVerb + "…"
            : (rowSurface.row.up && !rowSurface.row.pending ? "" : rowSurface.row.status)
          textFormat: Text.PlainText
          color: rowSurface.rowPending || rowSurface.row.pending ? Commons.Color.accent
            : (rowSurface.row.failing ? Commons.Color.urgent : root.dim)
          font.family: root.fontFamily
          font.pixelSize: root.fontSize.caption
          elide: Text.ElideRight
        }
      }

      ActionButtons {
        id: rowActions
        row: rowSurface.row
        actions: rowSurface.actions
        anchors.right: parent.right
        anchors.rightMargin: Style.spacing.md
        anchors.verticalCenter: parent.verticalCenter
      }
    }
  }
}
