const fs = require("fs")
const path = require("path")
const { test, ok, Model } = require("../harness.js")

// A drift alarm, not a proof. It scans the QML for keys the code binds and
// asserts each has a SHORTCUTS entry, so the four omissions this issue fixed
// cannot quietly come back. What it deliberately cannot see is written out
// below: anything it misses is a gap in the alarm, not a passing grade.

const ROOT = path.join(__dirname, "..", "..")
const SOURCES = ["MicrovmView.qml", "CreateForm.qml", "LogView.qml", "VmList.qml"]

// Qt.Key_* name -> the label SHORTCUTS uses for it.
const ALIAS = {
  Return: "enter", Enter: "enter", Escape: "esc", Space: "space",
  Tab: "tab", Backtab: "shift+tab",
  Up: "↑", Down: "↓", Left: "←", Right: "→",
  PageUp: "PageUp", PageDown: "PgDn", End: "end", Home: "home",
  J: "j", K: "k", G: "G"
}

// Bound in code but deliberately absent from the sheet, each with its reason.
const ALLOWED = {
  Backspace: "editing inside a text field, not a plugin binding",
  Delete: "editing inside a text field, not a plugin binding",
  X: "listed under Panel as X; matched case-insensitively below",
  Y: "an answer to a question; listed under Question",
  N: "an answer to a question; listed under Question"
}

test("every key the QML binds has a sheet entry (#25 drift alarm)", () => {
  const labels = new Set()
  for (const s of Model.SHORTCUTS) {
    for (const part of s.keys.split(/\s+/)) if (part) labels.add(part.toLowerCase())
  }

  const bound = new Set()
  for (const file of SOURCES) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8")
    for (const m of src.matchAll(/Qt\.Key_([A-Za-z]+)/g)) bound.add(m[1])
  }

  const missing = []
  for (const key of bound) {
    if (ALLOWED[key]) continue
    const label = ALIAS[key]
    if (!label) { missing.push(key + " (no alias mapping)"); continue }
    if (!labels.has(label.toLowerCase())) missing.push(key + " -> " + label)
  }
  ok(missing.length === 0, "bound but not on the ? sheet: " + missing.join(", "))

  // The four this issue added, pinned so a revert is loud.
  for (const want of ["pageup", "pgdn", "↑", "↓", "j", "k", "shift+tab", "y", "n"]) {
    ok(labels.has(want), "the sheet lost: " + want)
  }
})

// What this alarm does NOT see, so nobody reads a pass as coverage:
//   - printable keys routed through handleTextKey (?, /, u, a, o, c, i, X and
//     the "esrlmxy" row keys) never appear as Qt.Key_*;
//   - mode dependence: j and k navigate a switch row and type into a text
//     field, which no scan can tell apart;
//   - mouse-only actions: every row button, the hero's controls, the picker;
//   - keys handled by imported host components (PanelKeyCatcher, ConfirmDialog).
