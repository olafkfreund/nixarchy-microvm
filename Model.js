.pragma library

// All of the plugin's logic. No QML in here: this file runs under plain Node
// in tests/, and the QML side only draws and wires.

var Glyph = {
  vm: String.fromCodePoint(0xF0B4B),
  play: String.fromCodePoint(0xF040A),
  stop: String.fromCodePoint(0xF04DB),
  restart: String.fromCodePoint(0xF0709),
  console: String.fromCodePoint(0xF018D),
  logs: String.fromCodePoint(0xF0219),
  edit: String.fromCodePoint(0xF03EB),
  copy: String.fromCodePoint(0xF018F),
  refresh: String.fromCodePoint(0xF0450),
  search: String.fromCodePoint(0xF0349),
  remove: String.fromCodePoint(0xF0A7A),
  plus: String.fromCodePoint(0xF0415),
  apply: String.fromCodePoint(0xF0E4B),
  sparkle: String.fromCodePoint(0xF1B5D),
  alert: String.fromCodePoint(0xF002A),
  close: String.fromCodePoint(0xF0156),
  keyboard: String.fromCodePoint(0xF030C)
}

var MAX_FIELD = 64

// ---------------------------------------------------------------- keys
//
// The one list of what the keyboard does. The `?` sheet renders it and the
// docs quote it, so the two cannot drift apart. Keys that need a kind or a
// feature say so; actionsFor decides per row.

var SHORTCUTS = [
  { group: "Move", keys: "j  k  ↑ ↓", text: "Move the cursor down / up" },
  { group: "Move", keys: "/", text: "Jump into the filter box" },
  { group: "Move", keys: "k  ↑", text: "From the first row, step back up into the filter" },
  { group: "Move", keys: "esc", text: "Leave the filter, then close the panel" },

  { group: "VM", keys: "enter  e", text: "Open the console in a terminal (permanent: SSH, needs a port and a key)" },
  { group: "VM", keys: "s", text: "Start it or stop it" },
  { group: "VM", keys: "r", text: "Restart it (permanent)" },
  { group: "VM", keys: "l", text: "Follow its journal in a terminal (permanent)" },
  { group: "VM", keys: "m", text: "Edit it: the template, or every field of a permanent VM" },
  { group: "VM", keys: "x", text: "Delete it (running disposable stopped first; permanent state kept)" },
  { group: "VM", keys: "y", text: "Copy its name" },

  { group: "All VMs", keys: "c", text: "Create a new VM (opens at the name)" },
  { group: "All VMs", keys: "i", text: "Describe a VM to the default agent (opens at the description)" },
  { group: "All VMs", keys: "a", text: "Apply queued changes: nixarchy-apply in a terminal" },

  { group: "Panel", keys: "o", text: "Show the build log" },
  { group: "Panel", keys: "u", text: "Refresh now" },
  { group: "Panel", keys: "v", text: "Switch between the list and the overview" },
  { group: "Panel", keys: "tab", text: "Switch to the next bar panel" },
  { group: "Panel", keys: "shift+tab", text: "Switch to the previous bar panel" },
  { group: "Panel", keys: "X", text: "Give up on a change stuck over a minute" },
  { group: "Panel", keys: "?", text: "Show this list" },
  // Two entries, not one: form.test.js caps a key label at 12 characters, and
  // "y  n  enter  esc" is 16.
  { group: "Question", keys: "y  enter", text: "Answer yes" },
  { group: "Question", keys: "n  esc", text: "Answer no (the default)" },

  { group: "Form", keys: "tab  ↓", text: "Next field" },
  { group: "Form", keys: "shift+tab  ↑", text: "Previous field" },
  { group: "Form", keys: "space", text: "Flip a switch or the kind" },
  { group: "Form", keys: "enter", text: "Create, or review a permanent VM's line" },
  { group: "Form", keys: "j  k  ↑ ↓", text: "In the review: scroll the line" },
  { group: "Form", keys: "j  k", text: "Move between fields; on a text field they type, so use tab" },
  { group: "Form", keys: "↓", text: "Open the picker under a template or key field" },
  { group: "Form", keys: "esc", text: "Cancel" },

  { group: "Log", keys: "j  k", text: "Scroll (stops following)" },
  { group: "Log", keys: "↑  ↓", text: "Scroll (stops following)" },
  { group: "Log", keys: "PageUp  PgDn", text: "Scroll a screenful" },
  { group: "Log", keys: "G  end", text: "Jump to the end and follow" },
  { group: "Log", keys: "esc", text: "Back to the list; the job keeps running" }
]

function shortcutGroups() {
  var order = []
  var byGroup = {}
  for (var i = 0; i < SHORTCUTS.length; i++) {
    var entry = SHORTCUTS[i]
    if (!byGroup[entry.group]) {
      byGroup[entry.group] = []
      order.push(entry.group)
    }
    byGroup[entry.group].push({ keys: entry.keys, text: entry.text })
  }
  var out = []
  for (var g = 0; g < order.length; g++) {
    out.push({ title: order[g], entries: byGroup[order[g]] })
  }
  return out
}

// ---------------------------------------------------------------- text

function sanitize(value, maxLength) {
  var text = String(value === undefined || value === null ? "" : value)
  var limit = maxLength > 0 ? maxLength : MAX_FIELD
  var out = ""
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i)
    // Bidi overrides and isolates reorder what follows them, so a string can
    // render as something other than what it is; the separators break a line
    // in two. U+200E and U+200F are kept on purpose: they only mark direction
    // and cannot reorder.
    if (code < 0x20 || code === 0x7F || (code >= 0x80 && code <= 0x9F) ||
        (code >= 0x202A && code <= 0x202E) || (code >= 0x2066 && code <= 0x2069) ||
        code === 0x2028 || code === 0x2029) continue
    out += text.charAt(i)
  }
  out = out.replace(/^\s+|\s+$/g, "")
  if (out.length > limit) out = out.substring(0, limit - 1) + "…"
  return out
}

function trim(value) {
  return String(value === undefined || value === null ? "" : value).replace(/^\s+|\s+$/g, "")
}

function join(parts, separator) {
  var out = []
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] !== undefined && parts[i] !== null && String(parts[i]) !== "") out.push(String(parts[i]))
  }
  return out.join(separator === undefined ? " · " : separator)
}

function plural(count, noun) {
  return count + " " + noun + (count === 1 ? "" : "s")
}

// Terminal output from a nix build: colour codes, cursor moves, and progress
// bars that redraw themselves with \r. Keep what the last redraw left on the
// line, drop every escape sequence.
function stripAnsi(line) {
  var text = String(line === undefined || line === null ? "" : line)
  var cr = text.lastIndexOf("\r", text.length - 2)
  if (cr !== -1) text = text.substring(cr + 1)
  return text
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
}

var LINE_CAP = 2048

// ponytail: a line longer than 2 KB is a progress bar or a binary blob, not
// something to read; cut it rather than let one line grow the log unbounded.
function capLine(line) {
  var text = String(line === undefined || line === null ? "" : line)
  return text.length > LINE_CAP ? text.substring(0, LINE_CAP - 1) + "…" : text
}

var LOG_CAP = 400

// The log's whole growth rule in one place: clean each incoming line, append,
// keep the last LOG_CAP. `existing` arrives as a Qt sequence wrapper, so it is
// walked by index -- never concat, never Array.isArray (AGENTS.md). Pure: it
// returns a new plain array and never touches root.log.
function capLog(existing, incoming) {
  var out = []
  var have = existing || []
  for (var i = 0; i < have.length; i++) out.push(have[i])
  var add = incoming || []
  for (var j = 0; j < add.length; j++) out.push(capLine(stripAnsi(add[j])))
  return out.length > LOG_CAP ? out.slice(out.length - LOG_CAP) : out
}

// ---------------------------------------------------------------- identifiers

var KINDS = ["disposable", "permanent"]

// What a name may look like when it comes back from the CLI or from systemd:
// nixarchy-vm accepts [a-zA-Z0-9_-]+, and a unit instance is the same set.
// This is the rule for acting on an existing VM. Creation is stricter
// (isVmName, in the form section), so an existing VM is never stranded.
function isReportedName(value) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(value === undefined || value === null ? "" : value))
}

function isTemplateName(value) {
  return /^[a-z][a-z0-9-]{0,31}$/.test(String(value === undefined || value === null ? "" : value))
}

// A name that may stand as an unquoted Nix attribute: the floor for every
// writer that touches apps.nix. Laxer than isVmName, the rule for what this
// plugin will *create*; stricter than isReportedName, what the CLI and systemd
// may hand back. A leading digit is the case that matters -- `{ 9x = 1; }` is
// a Nix syntax error, while `{ a_b = 1; }` is fine, so an underscore is in and
// anywhere. `'` is legal in Nix and left out on purpose.
function isNixAttrName(value) {
  return /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(String(value === undefined || value === null ? "" : value))
}

var OPT_PREFIX = "programs.nixarchy.services.microvm.machines."

function optPath(name) {
  return OPT_PREFIX + name
}

// ---------------------------------------------------------------- parsing


// The list commands return JSON arrays. A different first byte means an old
// nixarchy answered without --json support.
function isJsonList(raw) {
  return trim(raw).charAt(0) === "["
}

function isTooOldList(raw) {
  if (!trim(raw)) return false
  try {
    return !Array.isArray(JSON.parse(String(raw)))
  } catch (e) {
    return true
  }
}

function parseJsonArray(raw) {
  try {
    var parsed = JSON.parse(String(raw || ""))
    return parsed && typeof parsed.length === "number" ? parsed : []
  } catch (e) {
    return []
  }
}

// `nixarchy vm list --json`: [{name, template, running, dir}].
function parseVmList(raw) {
  var out = []
  if (!isJsonList(raw)) return out
  var list = parseJsonArray(raw)
  for (var i = 0; i < list.length; i++) {
    var item = list[i] || {}
    if (!isReportedName(item.name)) continue
    out.push({
      name: String(item.name),
      template: isTemplateName(item.template) ? String(item.template) : "?",
      running: item.running === true,
      dir: sanitize(item.dir, 4096)
    })
  }
  return out
}

// `nixarchy vm templates --json`: [{name, label, note}].
function parseTemplates(raw) {
  var out = []
  if (!isJsonList(raw)) return out
  var list = parseJsonArray(raw)
  for (var i = 0; i < list.length; i++) {
    var item = list[i] || {}
    if (!isTemplateName(item.name)) continue
    out.push({ name: String(item.name), label: sanitize(item.label, 40) || String(item.name), note: sanitize(item.note, 400) })
  }
  return out
}

function templateNames(templates) {
  var out = []
  for (var i = 0; i < (templates || []).length; i++) out.push(templates[i].name)
  return out
}

// `systemctl list-units 'microvm@*' --all --plain --no-legend --output=json`:
// [{unit, load, active, sub, description}]. Only the instance name and the
// two state words matter here.
function parseUnits(raw) {
  var out = []
  var list = parseJsonArray(raw)
  for (var i = 0; i < list.length; i++) {
    var unit = String((list[i] || {}).unit || "")
    var m = unit.match(/^microvm@([^.]+)\.service$/)
    if (!m || !isReportedName(m[1])) continue
    out.push({ name: m[1], active: trim(list[i].active).toLowerCase(), sub: trim(list[i].sub).toLowerCase() })
  }
  return out
}

// The lines nixarchy.pkg's `opt set` writes into apps.nix, as nixarchy's own
// remover finds them: one physical line ending in `#@opt <path>`.
//
// A line is ours to edit (managed) only when it is an uncommented
// assignment whose left-hand path equals the marker's, and whose value
// reads back under the grammar machineSnippet writes. A marker with
// anything else on its line is shown but never rewritten
// (managed-unsupported). So is a marker whose name is not a valid unquoted
// Nix attribute: the writers refuse such a name, so the row must not offer an
// edit or a remove it cannot carry out. Its fields are kept as parsed, so the
// row still shows what the line says. A commented-out line declares nothing
// and is skipped: nixarchy would not build it either.
function parseMachineLines(text) {
  var out = []
  var lines = String(text || "").split("\n")
  var seen = Object.create(null)
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    var marker = line.match(/#@opt\s+programs\.nixarchy\.services\.microvm\.machines\.([A-Za-z0-9_-]+)\s*$/)
    if (!marker) continue
    var name = marker[1]
    if (/^\s*#/.test(line) || seen[name]) continue
    seen[name] = true
    var body = line.substring(0, marker.index)
    var assign = body.match(/^\s*programs\.nixarchy\.services\.microvm\.machines\.([A-Za-z0-9_-]+)\s*=\s*([\s\S]*?);\s*$/)
    var fields = assign && assign[1] === name ? parseMachineSnippet(assign[2]) : null
    out.push({ name: name, ownership: fields && isNixAttrName(name) ? "managed" : "managed-unsupported", fields: fields, line: trim(line) })
  }
  return out
}

// `nixarchy-pkg pending`: {ok, neverApplied, count, changes: [{marker, …}]}.
// A machine line's marker is "opt:<path>"; the service row's is ":microvm".
function parsePending(raw) {
  var out = { ok: false, neverApplied: false, machines: {}, service: false }
  var obj = null
  try { obj = JSON.parse(String(raw || "")) } catch (e) { return out }
  if (!obj || obj.ok !== true) return out
  out.ok = true
  out.neverApplied = obj.neverApplied === true
  var changes = obj.changes && typeof obj.changes.length === "number" ? obj.changes : []
  for (var i = 0; i < changes.length; i++) {
    var marker = String((changes[i] || {}).marker || "")
    if (marker === ":microvm") out.service = true
    else if (marker.indexOf("opt:" + OPT_PREFIX) === 0) {
      var name = marker.substring(("opt:" + OPT_PREFIX).length)
      if (isReportedName(name)) out.machines[name] = String(changes[i].change || "")
    }
  }
  return out
}

// ---------------------------------------------------------------- rows
//
// One row shape for both kinds. Three axes: what the system reports
// (runtime), who may edit (ownership), and whether nixarchy.pkg says the
// line is still to be applied (pending).

function rowKey(kind, name) {
  return kind + ":" + name
}

function baseRow(kind, name) {
  return {
    key: rowKey(kind, name),
    kind: kind,
    name: name,
    template: "",
    runtime: "none",
    ownership: kind === "disposable" ? "state" : "flake",
    pending: false,
    sshPort: "",
    sshKey: "",
    memory: "",
    cores: "",
    autostart: true,
    shares: "",
    line: ""
  }
}

function disposableRows(vms) {
  var out = []
  for (var i = 0; i < (vms || []).length; i++) {
    var row = baseRow("disposable", vms[i].name)
    row.template = vms[i].template
    row.runtime = vms[i].running ? "running" : "stopped"
    out.push(row)
  }
  return out
}

// Units and apps.nix lines, joined by name. A line with no unit is a machine
// nixarchy has not built yet (runtime "none"); a unit with no line was
// declared somewhere this plugin cannot edit (ownership "flake").
function permanentRows(units, machines, pending) {
  var byName = Object.create(null)
  var fromLine = Object.create(null)
  var order = []
  var list = machines || []
  for (var m = 0; m < list.length; m++) {
    var row = baseRow("permanent", list[m].name)
    fromLine[row.name] = true
    row.ownership = list[m].ownership
    row.line = list[m].line
    var f = list[m].fields
    if (f) {
      row.template = f.template
      row.autostart = f.autostart
      row.memory = String(f.memory)
      row.cores = String(f.cores)
      row.sshPort = f.sshPort === null ? "" : String(f.sshPort)
      row.sshKey = f.sshKey
      row.shares = f.shares
    }
    byName[row.name] = row
    order.push(row.name)
  }
  var us = units || []
  for (var u = 0; u < us.length; u++) {
    var name = us[u].name
    if (!byName[name]) {
      byName[name] = baseRow("permanent", name)
      order.push(name)
    }
    byName[name].runtime = us[u].active === "active" ? "running" : us[u].active === "failed" ? "failed" : "stopped"
  }
  var p = pending && pending.machines ? pending.machines : {}
  var names = Object.keys(p)
  for (var n = 0; n < names.length; n++) {
    var removed = names[n]
    if (p[removed] !== "removed" || fromLine[removed]) continue
    if (!byName[removed]) {
      byName[removed] = baseRow("permanent", removed)
      order.push(removed)
    }
    byName[removed].ownership = "removed"
  }
  var out = []
  for (var i = 0; i < order.length; i++) {
    byName[order[i]].pending = p[order[i]] !== undefined
    out.push(byName[order[i]])
  }
  return out
}

function compareRows(a, b) {
  var au = a.runtime === "running", bu = b.runtime === "running"
  if (au !== bu) return au ? -1 : 1
  var af = a.runtime === "failed", bf = b.runtime === "failed"
  if (af !== bf) return af ? -1 : 1
  if (a.pending !== b.pending) return a.pending ? -1 : 1
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

function mergeRows(rows) {
  return (rows || []).slice().sort(compareRows)
}

function rowNames(rows) {
  var out = []
  for (var i = 0; i < (rows || []).length; i++) out.push(rows[i].name)
  return out
}

function rowByKey(rows, key) {
  for (var i = 0; i < (rows || []).length; i++) {
    if (rows[i].key === key) return rows[i]
  }
  return null
}

function rowByName(rows, kind, name) {
  return rowByKey(rows, rowKey(kind, name))
}

function filterRows(rows, query) {
  var q = trim(query).toLowerCase()
  if (!q) return (rows || []).slice()
  var out = []
  for (var i = 0; i < (rows || []).length; i++) {
    var r = rows[i]
    if ((r.name + " " + r.template + " " + r.kind).toLowerCase().indexOf(q) !== -1) out.push(r)
  }
  return out
}

function statusText(row) {
  if (!row) return ""
  if (row.ownership === "removed") return "removed, pending apply"
  if (row.pending) return row.runtime === "none" ? "pending apply" : "changed, pending apply"
  if (row.runtime === "running") return "running"
  if (row.runtime === "failed") return "failed"
  if (row.runtime === "none") return "not built yet"
  return "stopped"
}

function ownershipText(row) {
  return row.ownership === "flake" ? "declared in your flake"
    : row.ownership === "managed-unsupported" ? "apps.nix, edited by hand" : ""
}

function subtitleText(row) {
  return join([row.kind, row.template, ownershipText(row)])
}

var ROW_FIELDS = ["name", "kind", "template", "runtime", "ownership", "subtitle", "status",
  "sshPort", "sshKey", "memory", "cores", "shares", "line", "autostart", "pending", "up", "failing"]

var ROW_BOOLEANS = ["autostart", "pending", "up", "failing"]

// A ListModel takes its role types from the first object it is handed and
// drops any field it cannot type, so hand it a fresh plain object with every
// field present and explicitly typed.
function rowRecord(row) {
  var out = { key: String(row.key) }
  for (var i = 0; i < ROW_FIELDS.length; i++) {
    var field = ROW_FIELDS[i]
    var value = row[field]
    out[field] = ROW_BOOLEANS.indexOf(field) !== -1
      ? value === true
      : String(value === undefined || value === null ? "" : value)
  }
  return out
}

// What the list draws: every row, sorted, with its derived text.
function rowsFor(rows) {
  var out = []
  var sorted = mergeRows(rows)
  for (var i = 0; i < sorted.length; i++) {
    var r = sorted[i]
    var full = {}
    for (var k in r) full[k] = r[k]
    full.subtitle = subtitleText(r)
    full.status = statusText(r)
    full.up = r.runtime === "running"
    full.failing = r.runtime === "failed"
    out.push(full)
  }
  return out
}

// ---------------------------------------------------------------- layout
//
// Style.space() is a rem unit: it tracks the desktop text size and knows
// nothing about the screen. These two turn what the host offers into what a
// surface may take, so the card follows the monitor and the body follows the
// card.

// A card width: a fraction of what the host offers, held between a floor and a
// ceiling that are themselves Style.space() values, so text size still counts.
function cardWidth(available, fraction, min, max) {
  var lo = Math.min(min, max)
  var hi = Math.max(min, max)
  if (!(available > 0)) return lo
  return Math.max(lo, Math.min(hi, Math.round(available * fraction)))
}

function cardColumns(width, minCardWidth) {
  return minCardWidth > 0 ? Math.max(1, Math.floor(width / minCardWidth)) : 1
}

function cardsNaturalHeight(count, columns, cellHeight) {
  return Math.ceil(count / columns) * cellHeight
}

// The menu card's size and top offset on a screen, in pixels; a floor size
// while no screen is known (#50).
function menuGeometry(screenW, screenH, minW, maxW, viewNaturalH, insetX, insetY, gaps) {
  if (screenW > 0 && screenH > 0) {
    var viewW = cardWidth(screenW, 0.55, minW, maxW)
    var width = Math.round(Math.min(viewW + insetX, Math.round(screenW * 0.9)))
    var height = Math.round(Math.min(viewNaturalH + insetY, Math.round(screenH * 0.85)))
    return { width: width, height: height, top: Math.round(Math.max(gaps, Math.round((screenH - height) / 3))) }
  }
  return { width: Math.round(Math.min(minW, maxW) + insetX),
    height: Math.round(viewNaturalH + insetY), top: Math.round(gaps) }
}

// What is left for the scrolling part once the fixed chrome has its share.
function bodyBudget(total, chrome) {
  if (!(total > 0)) return 0
  return Math.max(0, total - chrome)
}

// Which item owns the keyboard, as a function of state rather than of history.
// A question owns it wherever focus happened to be, which is the bug: opening a
// confirmation while the filter had focus left the filter eating y, n, Enter
// and Escape, so the question could not be answered from the keyboard at all.
// The commands the review promises to run, in full. It used to slice each argv
// to four tokens with no ellipsis, so for `nixarchy-pkg opt set <path> <value>`
// the value -- the entire line being written into apps.nix -- was simply not
// shown, on a screen whose job is to let the user confirm exactly that.
//
// The snippet is rendered as a reference rather than repeated, because the
// review already prints it in full immediately above; measuring nothing keeps
// this independent of the card's width.
function reviewCommandLines(argvs, snippet) {
  var out = []
  var list = argvs || []
  for (var i = 0; i < list.length; i++) {
    var argv = list[i] || []
    var parts = []
    for (var j = 0; j < argv.length; j++) {
      var token = String(argv[j])
      if (j === 0) parts.push(commandName(argv))
      else if (snippet && token === snippet) parts.push("\u2039the line above\u203a")
      else parts.push(token)
    }
    out.push(parts.join(" "))
  }
  return out
}

function focusTarget(state) {
  var s = state || {}
  if (s.confirmOpen) return "confirm"
  if (s.mode === "log" || s.mode === "form" || s.mode === "review") return s.mode
  return "list"
}

function clampCursor(cursorIndex, total) {
  if (total <= 0) return 0
  if (cursorIndex < 0) return 0
  if (cursorIndex > total - 1) return total - 1
  return cursorIndex
}

// The cursor's identity, reconciled against a list that re-sorts under it.
// The key is what an action applies to; the index is a cache for drawing, so a
// stale index can misdraw a highlight for a frame but can never act on the
// wrong machine. A key that has left the list falls back to its old position,
// clamped: the row that slid into the slot takes the cursor.
function resolveCursor(rows, key, index) {
  var list = rows || []
  if (list.length === 0) return { key: "", index: 0 }
  if (key) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return { key: key, index: i }
    }
  }
  var at = clampCursor(index, list.length)
  return { key: list[at].key, index: at }
}

// Where ↓/↑ (delta ±1) or the filter's ↓ (delta 0) put the cursor. With no
// active cursor, ↓ activates the first row rather than stepping past it
// (#5), and ↑ leaves for the filter; so does ↑ from the first row.
function stepCursor(active, index, delta, total) {
  if (total <= 0) return { active: false, index: 0, toFilter: true }
  if (delta < 0 && (!active || index === 0)) return { active: false, index: 0, toFilter: true }
  if (!active && delta > 0) return { active: true, index: 0, toFilter: false }
  return { active: true, index: clampCursor(index + delta, total), toFilter: false }
}

// The smallest list of ListModel operations that turns currentKeys into the
// keys of nextRows, so rows the cursor is on are moved rather than rebuilt.
function reconcilePlan(currentKeys, nextRows) {
  var keys = (currentKeys || []).slice()
  var next = nextRows || []
  var ops = []

  var wanted = {}
  for (var i = 0; i < next.length; i++) wanted[next[i].key] = true

  for (var r = keys.length - 1; r >= 0; r--) {
    if (wanted[keys[r]]) continue
    ops.push({ op: "remove", index: r })
    keys.splice(r, 1)
  }

  for (var n = 0; n < next.length; n++) {
    if (keys[n] === next[n].key) continue
    var found = keys.indexOf(next[n].key, n)
    if (found > n) {
      ops.push({ op: "move", from: found, to: n })
      keys.splice(n, 0, keys.splice(found, 1)[0])
    } else {
      ops.push({ op: "insert", index: n, row: next[n] })
      keys.splice(n, 0, next[n].key)
    }
  }
  return ops
}

// ---------------------------------------------------------------- summaries

function counts(rows) {
  var list = rows || []
  var out = { total: list.length, running: 0, failing: 0, pending: 0 }
  for (var i = 0; i < list.length; i++) {
    if (list[i].runtime === "running") out.running++
    if (list[i].runtime === "failed") out.failing++
    if (list[i].pending) out.pending++
  }
  return out
}

function listFailure(stderr, code) {
  return errorText(stderr) || "exit " + code
}

function summaryText(rows, reachable, listError, upstreamError) {
  if (!reachable) return "nixarchy-vm not found"
  if (upstreamError) return upstreamError
  if (listError) return "VM list failed: " + listError
  var c = counts(rows)
  if (c.total === 0) return "No VMs"
  return c.running + " of " + c.total + " running"
}

function footerText(rows) {
  var c = counts(rows)
  return plural(c.total, "VM") + " · " + c.running + " running" + (c.pending > 0 ? " · " + c.pending + " pending" : "")
}

// The one line shown when there is nothing to list. Says why.
function emptyText(state) {
  if (!state.everLoaded) return "Loading…"
  if (!state.reachable) return "nixarchy-vm is not on PATH"
  if (state.filtered) return "Nothing matches that filter"
  if (state.upstreamError) return state.upstreamError
  if (state.listError) return "VM list failed: " + state.listError
  if (!state.showStopped) return "No running VMs"
  return "No VMs yet — press c to create one"
}

// The CLI's or systemd's own error text, cut to the one line that says
// something. nixarchy-vm prefixes its refusals with "nixarchy-vm: ".
function errorText(raw) {
  var lines = String(raw || "").split("\n")
  var first = ""
  var lastError = ""
  for (var i = 0; i < lines.length; i++) {
    var line = trim(stripAnsi(lines[i]))
    if (!line || /^\+ /.test(line)) continue
    if (!first) first = line
    if (/^(nixarchy-vm:|nixarchy:|error:|Error:|Failed)/.test(line)) lastError = line
  }
  var chosen = lastError || first
  return chosen ? sanitize(chosen.replace(/^(nixarchy-vm:|nixarchy:|error:|Error:)\s*/i, ""), 160) : ""
}

// ---------------------------------------------------------------- settings

// The menu entry point is not a bar widget, so it has no setting(). It reads
// the widget's entry out of the bar layout instead: `bar.layout.<region>[]`,
// where an entry is either a bare id or {id, ...settings}. Only keys the
// defaults know about, carrying the same type, get through.
function settingsFor(barConfig, id, defaults) {
  var result = {}
  for (var key in defaults) result[key] = defaults[key]
  if (!barConfig || typeof barConfig !== "object") return result
  var layout = barConfig.layout && typeof barConfig.layout === "object" ? barConfig.layout : barConfig
  var regions = ["left", "center", "right"]
  for (var r = 0; r < regions.length; r++) {
    // Not Array.isArray: read through a QObject property, the layout's lists
    // are Qt sequence wrappers, which have a length but are not JS arrays.
    var list = layout[regions[r]]
    var entries = list && typeof list === "object" && typeof list.length === "number" ? list : []
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i]
      if (!entry || typeof entry !== "object" || entry.id !== id) continue
      for (var k in result) {
        if (k in entry && typeof entry[k] === typeof result[k]) result[k] = entry[k]
      }
      return result
    }
  }
  return result
}

// ---------------------------------------------------------------- validation
//
// Everything a user (or the agent) types ends up in one of two places: an
// argv slot for nixarchy-vm, or inside the one Nix line written to apps.nix.
// Each field is checked against what is safe in *its* spot, never against a
// blocklist of "bad" characters. Nothing here needs shell quoting, because
// nothing here goes through a shell: nixarchy-pkg's `opt set` takes the
// value as one argv element and parse-checks the file afterwards.

// Creation is stricter than isReportedName. A permanent name is a systemd
// instance, a hostname and an unquoted Nix attribute at once, and `_` is not
// legal in a hostname. A disposable name keeps the CLI's set but starts with
// a letter, so it can never look like an option.
function isVmName(value, kind) {
  var text = String(value === undefined || value === null ? "" : value)
  return kind === "permanent"
    ? /^[a-z][a-z0-9-]{0,31}$/.test(text)
    : /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(text)
}

function isTemplate(value, templates) {
  return isTemplateName(value) && templateNames(templates).indexOf(String(value)) !== -1
}

function isInteger(value, min, max) {
  var text = trim(value)
  if (!/^[0-9]{1,7}$/.test(text)) return false
  var n = parseInt(text, 10)
  return n >= min && n <= max
}

var MEMORY_MIN = 256, MEMORY_MAX = 131072, CORES_MAX = 64

function isMiB(value) { return isInteger(value, MEMORY_MIN, MEMORY_MAX) }
function isCores(value) { return isInteger(value, 1, CORES_MAX) }
function isPort(value) { return trim(value) === "" || isInteger(value, 1024, 65535) }

// ponytail: no spaces or quotes in paths. A path is written inside "…" in
// Nix, where only " \ and ${ act, and none of them is in this set.
function isPath(value) {
  return /^(\/|~\/)[A-Za-z0-9_.\/+-]*$/.test(String(value || "")) && String(value).length <= 4096
}

// HOME is spliced into a share source after isPath has judged the raw ~/ token,
// so it is the one string reaching nixString that no field allowlist covers.
// It must be a plain absolute path: no quote, no backslash, no ${, no . or ..
function isHostHome(value) {
  var text = String(value || "")
  if (!/^\/[A-Za-z0-9_.\/+-]*$/.test(text) || text.length > 4096) return false
  var parts = text.split("/")
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === "." || parts[i] === "..") return false
  }
  return true
}

// The host side of a share, judged like any path but with no . or .. segment,
// so a share cannot silently resolve outside the directory the user named.
function isHostPath(value) {
  if (!isPath(value)) return false
  var parts = String(value).split("/")
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === "." || parts[i] === "..") return false
  }
  return true
}

// Null when the path needs HOME and HOME cannot be written into Nix. An
// absolute path never needs it, so a pathological HOME blocks only the shares
// that actually use ~/.
function expandHome(path, hostHome) {
  var text = String(path || "")
  var host = trim(hostHome).replace(/\/+$/, "")
  if (text.indexOf("~/") !== 0) return text
  return isHostHome(host) ? host + text.substring(1) : null
}

// The guest side of a share, normalised before it is judged: "/mnt//src/"
// and "/mnt/src" are the same mount point, and "/nix/../etc" must not slip
// past the reserved list by spelling. Null when it cannot be made canonical.
function normalizeGuestPath(value) {
  var text = String(value || "")
  if (text.charAt(0) !== "/" || !isPath(text)) return null
  var parts = text.split("/")
  var out = []
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === "") continue
    if (parts[i] === "." || parts[i] === "..") return null
    out.push(parts[i])
  }
  return "/" + out.join("/")
}

// What modules/microvm/guest.nix already mounts, and the root itself.
function isReservedGuest(path) {
  return path === "/" || path === "/nix" || path.indexOf("/nix/") === 0 || path === "/mnt/host"
}

var BUILTIN_TAGS = ["ro-store", "hostdir"]

function tokens(value) {
  var text = trim(value)
  return text ? text.split(/\s+/) : []
}

// "host:guest host2:guest2" → [{source, mountPoint}] with ~ expanded and the
// guest path canonical, or null with the first reason in `error`.
function parseShares(value, hostHome) {
  var list = tokens(value)
  var out = []
  var guests = Object.create(null)
  for (var i = 0; i < list.length; i++) {
    var parts = list[i].split(":")
    if (parts.length !== 2) return { error: "Each share is host:guest" }
    if (!isHostPath(parts[0])) return { error: "Host paths are absolute or ~/…, using " + PATH_CHARS + ", with no . or .. segments" }
    var guest = normalizeGuestPath(parts[1])
    if (!guest) return { error: "Guest paths are absolute, with no . or .. segments" }
    if (isReservedGuest(guest)) return { error: guest + " is already used inside the guest" }
    if (Object.prototype.hasOwnProperty.call(guests, guest)) return { error: "Two shares mount at " + guest }
    guests[guest] = true
    var source = expandHome(parts[0], hostHome)
    if (source === null) return { error: "HOME is not a plain absolute path, so ~/ cannot be expanded; write the path in full" }
    out.push({ source: source, mountPoint: guest })
  }
  return { shares: out }
}

// One virtiofs tag per share: the mount point's basename, suffixed when two
// shares would collide, and never one guest.nix already uses.
function shareTags(shares) {
  var used = BUILTIN_TAGS.slice()
  var out = []
  for (var i = 0; i < (shares || []).length; i++) {
    // Only what the parser's tag class accepts, and short enough that the
    // collision suffix below cannot push it past the 64 that class allows.
    var base = (shares[i].mountPoint.replace(/\/+$/, "").split("/").pop() || "share")
      .replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 58) || "share"
    var tag = base
    for (var n = 2; used.indexOf(tag) !== -1; n++) tag = base + "-" + n
    used.push(tag)
    out.push(tag)
  }
  return out
}

// A public key as ssh-keygen writes it: type, base64, and a comment we drop.
// Only the first two words are kept, so the line inside "…" in Nix can hold
// nothing but this character set.
var SSH_KEY = /^(ssh-ed25519|ecdsa-sha2-nistp(256|384|521)|ssh-rsa|sk-ssh-ed25519@openssh\.com) ([A-Za-z0-9+\/]+={0,3})(\s|$)/

function normalizeSshKey(value) {
  var m = String(value || "").replace(/^\s+/, "").match(SSH_KEY)
  return m ? m[1] + " " + m[3] : ""
}

function isSshKey(value) {
  return normalizeSshKey(value) !== ""
}

function hasControlChars(value) {
  return /[\x00-\x1f\x7f]/.test(String(value || ""))
}

function isDescribe(value) {
  var text = String(value || "")
  return text.length <= 500 && !hasControlChars(text)
}

// ---------------------------------------------------------------- form

var PATH_CHARS = "letters, digits and _ . / + -"

// Every value a string or a bool, so the QML text fields can bind to it and
// the agent's typed reply is converted before it lands here.
function emptyForm(kind) {
  return {
    editing: false,
    describe: "",
    kind: kind === "permanent" ? "permanent" : "disposable",
    name: "",
    template: "shell",
    autostart: true,
    startNow: true,
    memory: "1024",
    cores: "1",
    advanced: false,
    sshPort: "",
    sshKey: "",
    shares: ""
  }
}

// The form for `m` on a row: what its line says, with the name fixed.
function formFromRow(row) {
  var f = emptyForm(row.kind)
  f.editing = true
  f.name = row.name
  f.template = row.template || "shell"
  if (row.kind === "permanent") {
    f.autostart = row.autostart !== false
    f.memory = String(row.memory || "1024")
    f.cores = String(row.cores || "1")
    f.sshPort = String(row.sshPort || "")
    f.sshKey = String(row.sshKey || "")
    f.shares = String(row.shares || "")
    f.advanced = !!(f.sshPort || f.sshKey || f.shares)
  }
  return f
}

// {ok, errors: {field: text}, warnings: {field: text}}. An error blocks the
// submit; a warning is shown and allowed.
function validateForm(form, rows, templates, hostHome) {
  var f = form || {}
  var errors = {}
  var warnings = {}
  var kind = f.kind === "permanent" ? "permanent" : "disposable"
  var name = trim(f.name)

  if (!isDescribe(f.describe)) errors.describe = "At most 500 characters, no line breaks"

  if (!name) errors.name = "A name is required"
  else if (!(f.editing === true
    ? (kind === "permanent" ? isNixAttrName(name) : isReportedName(name))
    : isVmName(name, kind))) {
    errors.name = kind === "permanent"
      ? "Lower-case letters, digits and -, starting with a letter, at most 32"
      : "Letters, digits, _ and -, starting with a letter, at most 64"
  } else if (f.editing !== true) {
    // A machine removed but not yet applied has no line, so its name is free again.
    var existing = rowByName(rows, kind, name)
    if (existing && existing.ownership !== "removed") errors.name = "A " + kind + " VM called " + name + " already exists"
  }

  if (!isTemplate(trim(f.template), templates)) errors.template = "Pick a template from the list"

  if (kind === "permanent") {
    if (!isMiB(f.memory)) errors.memory = "Whole MiB between " + MEMORY_MIN + " and " + MEMORY_MAX
    else if (parseInt(trim(f.memory), 10) > 8192) warnings.memory = "More than 8 GiB is taken from the host while the VM runs"
    if (!isCores(f.cores)) errors.cores = "Between 1 and " + CORES_MAX
    if (!isPort(f.sshPort)) errors.sshPort = "Empty (no SSH), or a port from 1024 to 65535"
    else if (trim(f.sshPort)) {
      var port = parseInt(f.sshPort, 10)
      for (var p = 0; p < (rows || []).length; p++) {
        var row = rows[p]
        if (row.kind === "permanent" && row.name !== name && trim(row.sshPort)
            && parseInt(row.sshPort, 10) === port) {
          errors.sshPort = "Port " + port + " is already used by " + row.name
          break
        }
      }
    }
    if (trim(f.sshKey) && !isSshKey(f.sshKey)) errors.sshKey = "Pick a key from ~/.ssh, or paste a public key line"
    if (trim(f.sshPort) && !trim(f.sshKey)) warnings.sshKey = "The guest's dev user has no password: without a key the port reaches a daemon nobody can log into"
    var shares = parseShares(f.shares, hostHome)
    if (shares.error) errors.shares = shares.error
    else {
      var host = trim(hostHome).replace(/\/+$/, "")
      for (var i = 0; i < shares.shares.length; i++) {
        if (host && shares.shares[i].source === host) warnings.shares = "Sharing your whole home directory with the guest"
      }
    }
  }

  var ok = true
  for (var k in errors) { ok = false; break }
  return { ok: ok, errors: errors, warnings: warnings }
}

// ---------------------------------------------------------------- snippet grammar
//
// The one line this plugin writes for a permanent VM, and the only Nix it
// ever emits. Every field is written, defaults included, so the line reads
// back into the form without knowing the module's defaults.
//
// Nothing is escaped. That is safe because every string is checked against
// nixSafe immediately before it is written and the line is refused otherwise,
// not because the values happen to be clean: an earlier version of this
// comment claimed the latter and was wrong, since HOME was spliced into a
// share source after isPath had judged the raw ~/ token. The field allowlists
// -- isTemplateName, isHostPath, normalizeGuestPath, isHostHome, the tag
// sanitiser and SSH_KEY -- are why that check never fires for a form a user
// could submit.
//
// parseMachineSnippet deliberately accepts a superset of this: a wider tag, a
// .. in a host path. That keeps a line an earlier version wrote editable
// instead of disowning it. It is a judgement about syntax, not a claim that
// the line came from this emitter -- and a line changed by hand outside the
// grammar is still recognised as not ours rather than rewritten.

// What the emitter is allowed to write inside "…". Nix interprets " \ and ${,
// and nixString escapes nothing, so every string is checked here first and the
// line refused if the check fails. It is an assertion, not a filter: the field
// allowlists are what make it unreachable.
function nixSafe(value) {
  var text = String(value === undefined || value === null ? "" : value)
  return !/["\\]/.test(text) && text.indexOf("${") === -1 && !hasControlChars(text)
}

function nixString(value) {
  return '"' + value + '"'
}

// The line's value, or null when validateForm says no.
function machineSnippet(form, rows, templates, hostHome) {
  var f = form || {}
  if (f.kind !== "permanent" || !validateForm(f, rows, templates, hostHome).ok) return null
  var shares = parseShares(f.shares, hostHome).shares
  var tags = shareTags(shares)
  var parts = [
    "template = " + nixString(trim(f.template)) + ";",
    "autostart = " + (f.autostart === true ? "true" : "false") + ";",
    "memory = " + parseInt(trim(f.memory), 10) + ";",
    "cores = " + parseInt(trim(f.cores), 10) + ";",
    "sshPort = " + (trim(f.sshPort) ? parseInt(trim(f.sshPort), 10) : "null") + ";"
  ]
  var list = []
  for (var i = 0; i < shares.length; i++) {
    list.push("{ source = " + nixString(shares[i].source) + "; mountPoint = " + nixString(shares[i].mountPoint) + "; tag = " + nixString(tags[i]) + "; }")
  }
  parts.push("shares = [ " + (list.length ? list.join(" ") + " " : "") + "];")
  var key = normalizeSshKey(f.sshKey)
  if (key) parts.push("modules = [ { users.users.dev.openssh.authorizedKeys.keys = [ " + nixString(key) + " ]; } ];")
  // Every string this line carries, checked before it is written. The field
  // allowlists above are what make this unreachable; it is here so that a
  // future field cannot quietly reintroduce the hole HOME opened.
  var written = [trim(f.template), key]
  for (var t = 0; t < shares.length; t++) written.push(shares[t].source, shares[t].mountPoint, tags[t])
  for (var w = 0; w < written.length; w++) {
    if (!nixSafe(written[w])) return null
  }
  return "{ " + parts.join(" ") + " }"
}

var SNIPPET_RE = new RegExp(
  '^\\{ template = "([a-z][a-z0-9-]{0,31})"; autostart = (true|false); memory = ([0-9]{1,7}); cores = ([0-9]{1,3}); sshPort = ([0-9]{1,5}|null); ' +
  'shares = \\[ ((?:\\{ source = "[^"]*"; mountPoint = "[^"]*"; tag = "[^"]*"; \\} )*)\\];' +
  '(?: modules = \\[ \\{ users\\.users\\.dev\\.openssh\\.authorizedKeys\\.keys = \\[ "([^"]*)" \\]; \\} \\];)? \\}$'
)

var SHARE_RE = /\{ source = "([^"]*)"; mountPoint = "([^"]*)"; tag = "([^"]*)"; \} /g

// {template, autostart, memory, cores, sshPort (number or null), sshKey,
// shares (the form's "host:guest …" string)}, or null.
function parseMachineSnippet(text) {
  var m = trim(text).match(SNIPPET_RE)
  if (!m) return null
  if (!isMiB(m[3]) || !isCores(m[4]) || (m[5] !== "null" && !isPort(m[5]))) return null
  var shares = []
  var pairs = []
  SHARE_RE.lastIndex = 0
  var s
  while ((s = SHARE_RE.exec(m[6])) !== null) {
    var guest = normalizeGuestPath(s[2])
    if (!isPath(s[1]) || s[1].charAt(0) !== "/" || !guest || guest !== s[2] || isReservedGuest(guest)) return null
    // Wider than the emitter's own class on purpose: a line an earlier version
    // wrote with a "+" or an over-long tag must stay readable, so it stays
    // editable. Tags are discarded on read and re-derived on write, so this is
    // syntactic safety, not a claim the line came from this emitter.
    if (!/^[A-Za-z0-9_.+-]{1,4096}$/.test(s[3]) || BUILTIN_TAGS.indexOf(s[3]) !== -1) return null
    shares.push({ source: s[1], mountPoint: guest })
    pairs.push(s[1] + ":" + guest)
  }
  var key = ""
  if (m[7] !== undefined) {
    key = normalizeSshKey(m[7])
    if (key !== m[7]) return null
  }
  return {
    template: m[1],
    autostart: m[2] === "true",
    memory: parseInt(m[3], 10),
    cores: parseInt(m[4], 10),
    sshPort: m[5] === "null" ? null : parseInt(m[5], 10),
    sshKey: key,
    shares: pairs.join(" ")
  }
}

// One line for the review screen and the log.
function formSummary(form) {
  var f = form || {}
  return (f.editing ? "edit " : "create ") + trim(f.name) + " (" + (f.kind === "permanent" ? "permanent" : "disposable") + ", " + trim(f.template) + ")"
}

// ---------------------------------------------------------------- form layout
//
// The order the form shows its fields in, and what each one is. `widget`
// picks the drawing: text, kind (a two-way switch), template (text plus the
// list), key (text plus the ~/.ssh list), bool. `permanent` marks fields a
// disposable VM does not have; `create` marks ones an edit hides.

var FORM_FIELDS = [
  { key: "describe", widget: "text", label: "Describe it, and let the agent fill the rest", hint: "e.g. a python box with 4 GB and my ~/src shared. Enter asks the agent.", create: true, agent: true },
  { key: "kind", widget: "kind", label: "Kind", hint: "space flips. Disposable: no root, no rebuild. Permanent: boots with the host, one line in apps.nix", create: true },
  { key: "name", widget: "text", label: "Name", hint: "Required", create: true },
  { key: "template", widget: "template", label: "Template", hint: "↓ picks from the list" },
  { key: "startNow", widget: "bool", label: "Start it now", disposable: true, create: true },
  { key: "autostart", widget: "bool", label: "Start at boot", permanent: true },
  { key: "memory", widget: "text", label: "Memory (MiB)", hint: "256 to 131072", permanent: true },
  { key: "cores", widget: "text", label: "Cores", hint: "1 to 64", permanent: true },
  { key: "advanced", widget: "bool", label: "SSH and shares", permanent: true },
  { key: "sshPort", widget: "text", label: "SSH port on the host", hint: "Empty means console only. 1024 to 65535", permanent: true, advanced: true },
  { key: "sshKey", widget: "key", label: "SSH public key", hint: "↓ picks one from ~/.ssh; needed to log in over the port", permanent: true, advanced: true },
  { key: "shares", widget: "text", label: "Shares", hint: "host:guest pairs, space-separated, e.g. ~/src:/mnt/src", permanent: true, advanced: true }
]

// `state` is {agent, aiAssist}: the describe field exists only when the
// default agent is one this plugin can call, and the setting allows it.
function visibleFields(form, state) {
  var f = form || {}
  var out = []
  for (var i = 0; i < FORM_FIELDS.length; i++) {
    var field = FORM_FIELDS[i]
    if (field.create && f.editing === true) continue
    if (field.permanent && f.kind !== "permanent") continue
    if (field.disposable && f.kind === "permanent") continue
    if (field.advanced && f.advanced !== true) continue
    if (field.agent && !(state && state.agent && state.aiAssist !== false)) continue
    out.push(field)
  }
  return out
}

// The name of the disposable VM to start once its create succeeds, or "".
function startAfterCreate(form) {
  var f = form || {}
  if (f.kind !== "disposable" || f.editing === true || f.startNow === false) return ""
  return trim(f.name)
}

// Where the cursor starts: the index of `key`, or the first field.
function fieldIndexOf(fields, key) {
  for (var i = 0; i < (fields || []).length; i++) if (fields[i].key === key) return i
  return 0
}

// Where the cursor lands to show the first error: in field order.
function firstErrorIndex(fields, errors) {
  for (var i = 0; i < (fields || []).length; i++) {
    if (errors && errors[fields[i].key]) return i
  }
  return -1
}

function hiddenFieldError(fields, errors) {
  for (var key in errors || {}) {
    var visible = false
    for (var i = 0; i < (fields || []).length; i++) {
      if (fields[i].key === key) { visible = true; break }
    }
    if (visible) continue
    for (var j = 0; j < FORM_FIELDS.length; j++) {
      if (FORM_FIELDS[j].key === key) return FORM_FIELDS[j].label + ": " + errors[key]
    }
  }
  return ""
}

function keysMatching(keys, query) {
  var q = String(query || "").toLowerCase()
  var out = []
  for (var i = 0; i < (keys || []).length; i++) {
    var k = keys[i]
    if (!q || q === k.key.toLowerCase() || (k.file + " " + k.key).toLowerCase().indexOf(q) !== -1) out.push(k)
  }
  return out
}

function templatesMatching(templates, query) {
  var q = trim(query).toLowerCase()
  var out = []
  for (var i = 0; i < (templates || []).length; i++) {
    var t = templates[i]
    if (!q || (t.name + " " + t.label).toLowerCase().indexOf(q) !== -1) out.push(t)
  }
  return out
}

// ---------------------------------------------------------------- features
//
// The required nixarchy commands are named in help; nixarchy-pkg answers
// `opt replace` with a usage line. JSON listing is checked separately.
function upstreamVerdict(helpText, optReply, pkgPresent) {
  var text = String(helpText || "")
  if (!/\brun\b[^\n]*--detach/.test(text) || !/\bvm console\b/.test(text) || !/\bset-template\b/.test(text))
    return "This plugin needs nixarchy with nixarchy vm run --detach, console and set-template (nixarchy#762); update nixarchy"
  if (pkgPresent && !optReplaceSupported(optReply))
    return "This plugin needs nixarchy-pkg opt replace (nixarchy-pkg#19); update nixarchy.pkg"
  return ""
}

// Today: {"ok":false,"error":"opt takes describe, set or remove, not
// 'replace'"}. With the feature: a usage line naming `opt replace`.
function optReplaceSupported(reply) {
  return /usage:\s*nixarchy-pkg opt replace/i.test(String(reply || ""))
}

// services.nix is written once and never regenerated, so an older one has no
// microvm row and nixarchy-service-enable refuses it (#6). This is the marker
// that script greps for, commented out or not.
function servicesHasMicrovm(text) {
  return /#@ microvm(\s|$)/m.test(String(text || ""))
}

// nixarchy#843: once nixarchy-service-enable adds a missing row itself, its
// --help says so. Today --help is taken as a service id and only complains.
function serviceHelpArgv() {
  return ["nixarchy-service-enable", "--help"]
}

function serviceEnableHeals(reply) {
  var text = String(reply || "")
  return /usage:\s*nixarchy-service-enable/i.test(text) && /missing/i.test(text)
}

// Why a new permanent VM cannot be written yet, or "". Only when the row is
// known to be missing; an edit rewrites an existing line and needs no row.
function permanentBlocked(form, state) {
  var f = form || {}
  var s = state || {}
  if (f.kind !== "permanent" || f.editing === true || s.servicesRow !== false) return ""
  return "services.nix predates the microvm row: copy the line ending in #@ microvm from /etc/nixarchy/services-template.nix into ~/.config/nixarchy/services.nix"
}

// nixarchy.pkg's adapter sits inside that plugin, not on PATH.
function pkgScriptPath(configHome) {
  var base = trim(configHome).replace(/\/+$/, "")
  return base ? base + "/omarchy/plugins/nixarchy.pkg/bin/nixarchy-pkg" : ""
}

// ---------------------------------------------------------------- commands
//
// Argv arrays only. Each returns null when an input would not be safe in its
// slot, and the caller does nothing. Names of existing VMs pass
// isReportedName; a new name passes the stricter isVmName for its kind.

function listArgv() { return ["nixarchy-vm", "list", "--json"] }
function templatesArgv() { return ["nixarchy-vm", "templates", "--json"] }
function helpArgv() { return ["nixarchy-vm", "help"] }
function unitsArgv() { return ["systemctl", "list-units", "microvm@*", "--all", "--plain", "--no-legend", "--output=json"] }
function defaultAgentArgv() { return ["omarchy-default-agent"] }
function serviceEnableArgv() { return ["nixarchy-service-enable", "microvm"] }
function applyTerminalArgv() { return ["omarchy-launch-floating-terminal-with-presentation", "nixarchy-apply"] }

function pendingArgv(pkg) { return pkg ? [pkg, "pending"] : null }
function optProbeArgv(pkg) { return pkg ? [pkg, "opt", "replace"] : null }

function tui(appId, argv) {
  return ["omarchy-launch-tui", "--app-id=org.omarchy.microvm-" + appId].concat(argv)
}

// A running disposable VM's console, in a terminal.
function consoleArgv(name) {
  return isReportedName(name) ? tui("console", ["nixarchy-vm", "console", name]) : null
}

function runDetachArgv(name) {
  return isReportedName(name) ? ["nixarchy-vm", "run", "--detach", name] : null
}

function stopVmArgv(name) {
  return isReportedName(name) ? ["nixarchy-vm", "stop", name] : null
}

function rmVmArgv(name) {
  return isReportedName(name) ? ["nixarchy-vm", "rm", name] : null
}

function createVmArgv(name, template, templates) {
  if (!isVmName(name, "disposable") || !isTemplate(template, templates)) return null
  return ["nixarchy-vm", "create", name, "--template", template]
}

function setTemplateArgv(name, template, templates) {
  if (!isReportedName(name) || !isTemplate(template, templates)) return null
  return ["nixarchy-vm", "set-template", name, template]
}

var UNIT_VERBS = ["start", "stop", "restart"]

// systemd asks polkit itself; Omarchy's agent draws the prompt.
function unitArgv(verb, name) {
  if (UNIT_VERBS.indexOf(verb) === -1 || !isReportedName(name)) return null
  return ["systemctl", verb, "microvm@" + name + ".service"]
}

function logsArgv(name) {
  return isReportedName(name) ? tui("logs", ["journalctl", "-u", "microvm@" + name, "-n", "200", "-f"]) : null
}

// The key picked in the form may not be one ssh offers by default, so the
// console names it: the .pub whose content matches the row's key, minus
// ".pub". No match (or no scan yet) falls back to ssh's own identities.
function sshArgv(port, sshKey, keys, home) {
  if (!isPort(port) || trim(port) === "") return null
  var argv = ["ssh", "-p", trim(port)]
  var want = normalizeSshKey(sshKey)
  var h = trim(home).replace(/\/+$/, "")
  for (var i = 0; want && h && keys && i < keys.length; i++) {
    var f = String(keys[i].file || "")
    if (keys[i].key === want && /^[A-Za-z0-9._-]+\.pub$/.test(f)) {
      argv.push("-i", h + "/.ssh/" + f.slice(0, -4), "-o", "IdentitiesOnly=yes")
      break
    }
  }
  argv.push("dev@localhost")
  return tui("console", argv)
}

function optSetArgv(pkg, name, snippet) {
  return pkg && isVmName(name, "permanent") && snippet ? [pkg, "opt", "set", optPath(name), snippet] : null
}

function optReplaceArgv(pkg, name, snippet) {
  return pkg && isNixAttrName(name) && snippet ? [pkg, "opt", "replace", optPath(name), snippet] : null
}

function optRemoveArgv(name) {
  return isNixAttrName(name) ? ["nixarchy-opt-remove", optPath(name)] : null
}

function copyArgv(name) {
  return isReportedName(name) ? ["wl-copy", "--trim-newline", name] : null
}

// The queued commands for a submitted form: one for a disposable VM, two for
// a new permanent one (the service row, then its line), one for an edit.
// Null when the form is invalid or the required upstream is unavailable.
function submitArgvs(form, rows, templates, hostHome, state) {
  var f = form || {}
  var s = state || {}
  if (!s.upstreamOk) return null
  if (f.kind === "permanent") {
    if (permanentBlocked(f, s)) return null
    var snippet = machineSnippet(f, rows, templates, hostHome)
    if (!snippet || !s.pkgScript) return null
    if (f.editing === true) {
      var replace = optReplaceArgv(s.pkgScript, trim(f.name), snippet)
      return replace ? [replace] : null
    }
    var set = optSetArgv(s.pkgScript, trim(f.name), snippet)
    return set ? [serviceEnableArgv(), set] : null
  }
  if (!validateForm(f, rows, templates, hostHome).ok) return null
  if (f.editing === true) {
    var setT = setTemplateArgv(trim(f.name), trim(f.template), templates)
    return setT ? [setT] : null
  }
  var create = createVmArgv(trim(f.name), trim(f.template), templates)
  return create ? [create] : null
}

// ---------------------------------------------------------------- row actions

function action(verb, key, glyph, tooltip, danger, enabled) {
  return { verb: verb, key: key, glyph: glyph, tooltip: tooltip, danger: danger === true, enabled: enabled !== false }
}

// The one place a key's applicability is decided. `state` is
// {mutating, upstreamOk, pkgScript, pendingSync}.
// A verb that does not apply to the row is absent; one that only waits
// for the lock is present and disabled. Console, logs and copy never lock.
function actionsFor(row, state) {
  if (!row) return []
  var s = state || {}
  if (!s.upstreamOk) return [action("copy", "y", Glyph.copy, "Copy the name  (y)", false, true)]
  var free = !s.mutating
  var out = []
  var running = row.runtime === "running"
  if (row.kind === "disposable") {
    if (running) out.push(action("console", "enter", Glyph.console, "Open the console  (enter)", false, true))
    if (running) out.push(action("stop", "s", Glyph.stop, "Stop  (s)", true, free))
    else out.push(action("start", "s", Glyph.play, "Start, with the build log here  (s)", false, free))
    if (!running) out.push(action("edit", "m", Glyph.edit, "Change the template  (m)", false, free))
    out.push(action("remove", "x", Glyph.remove, "Delete, with its state  (x)", true, free))
  } else {
    var managed = row.ownership === "managed"
    if (running && managed && trim(row.sshPort) && trim(row.sshKey) && !row.pending && !s.pendingSync) out.push(action("console", "enter", Glyph.console, "SSH into it  (enter)", false, true))
    if (row.runtime !== "none") {
      if (running) {
        out.push(action("restart", "r", Glyph.restart, "Restart  (r)", false, free))
        out.push(action("stop", "s", Glyph.stop, "Stop  (s)", true, free))
      } else {
        out.push(action("start", "s", Glyph.play, "Start  (s)", false, free))
      }
      out.push(action("logs", "l", Glyph.logs, "Follow the journal  (l)", false, true))
    }
    if (managed && s.pkgScript) out.push(action("edit", "m", Glyph.edit, "Edit its line  (m)", false, free))
    if (managed) out.push(action("remove", "x", Glyph.remove, "Remove its line from apps.nix  (x)", true, free))
  }
  out.push(action("copy", "y", Glyph.copy, "Copy the name  (y)", false, true))
  return out
}

// The row's buttons: one per verb.
function buttonsFor(row, state) {
  var list = actionsFor(row, state)
  var seen = {}
  var out = []
  for (var i = 0; i < list.length; i++) {
    if (seen[list[i].verb]) continue
    seen[list[i].verb] = true
    out.push(list[i])
  }
  return out
}

function actionFor(row, state, verb) {
  var list = actionsFor(row, state)
  for (var i = 0; i < list.length; i++) {
    if (list[i].verb === verb) return list[i]
  }
  return null
}

// The row action a key maps to, or null: a key that means nothing for this
// row is a no-op, so the footer, the sheet and the keys can never disagree.
function verbForKey(row, state, key) {
  var list = actionsFor(row, state)
  for (var i = 0; i < list.length; i++) {
    if (list[i].key === key) return list[i].verb
  }
  return null
}

// Keys that belong to the list rather than a row.
function listActions(state, c) {
  var s = state || {}
  var counts = c || {}
  return {
    create: !!s.upstreamOk,
    // schemaLoaded false means schema.json could not be read, so the reply
    // could never be validated: offering i would be offering a dead key.
    assist: !!s.upstreamOk && !!s.agent && s.aiAssist !== false && s.schemaLoaded !== false,
    apply: !!s.upstreamOk && !!s.pkgScript && (counts.pending > 0 || s.serviceQueued === true)
  }
}

// Why a key is not there, for the hint under the list.
function hiddenReason(row, state, verb) {
  var s = state || {}
  if (!s.upstreamOk) return s.upstreamError || "checking nixarchy…"
  if (!row) return ""
  if (row.kind === "permanent" && row.ownership === "removed") return "removed, pending apply"
  if (row.kind === "disposable") {
    if (verb === "edit" && row.runtime === "running") return "stop it first to change the template"
    return ""
  }
  if (verb === "console") {
    if (row.ownership !== "managed") return "console only through SSH, and this VM's line is not managed here"
    if (!trim(row.sshPort) || !trim(row.sshKey)) return "set an SSH port and key to get a console"
    if (row.runtime !== "running") return "start it first"
    if (row.pending || s.pendingSync) return "apply the queued change first"
  }
  if (verb === "edit" || verb === "remove") {
    if (row.ownership === "flake") return "declared in your flake; edit it there"
    if (row.ownership === "managed-unsupported") return "this line was edited by hand; edit it in apps.nix"
    if (verb === "edit" && !s.pkgScript) return "permanent VMs need the nixarchy.pkg plugin"
  }
  return ""
}

function pendingName(pendingKey) {
  var key = String(pendingKey || "")
  var colon = key.indexOf(":")
  return colon === -1 ? "" : key.substring(colon + 1)
}

// The next command is chosen here; QML only carries it out after the process exits.
function continueAfter(next, event) {
  if (!event || (event.type !== "exit" && event.type !== "tick")) return { do: "fail", message: "invalid continuation event", next: null }
  if (event.type === "exit") {
    if (next && next.kind === "wait" && next.resending) {
      var waiting = Object.assign({}, next)
      waiting.resending = false
      return { do: "wait", next: waiting }
    }
    if (!event.ok) return { do: "fail", message: "command failed", next: null }
    if (!next || next.kind === "last") return { do: "done", next: null }
    if (next.kind === "stream" || next.kind === "rm") return { do: next.kind, name: next.name, next: { kind: "last", name: next.name } }
    if (next.kind === "wait") return { do: "wait", next: next }
  } else if (next && next.kind === "wait") {
    var step = removeWaitStep(next, event.listOk, event.listGen, event.stopped, event.now)
    if (step === "rm") return { do: "rm", name: next.name, next: { kind: "last", name: next.name } }
    if (step === "resend") return { do: "stop", name: next.name, next: Object.assign({}, next, { resent: true, resending: true }) }
    if (step === "timeout") return { do: "fail", message: next.name + " did not stop within 90 s; nothing was deleted", next: null }
    return { do: "wait", next: next }
  }
  return { do: "fail", message: "invalid continuation step", next: null }
}

// What X says when it abandons a chained action. Only before rm starts is it
// certain that nothing was deleted (#49).
function abandonMessage(next, pendingVerb) {
  var n = next || {}
  if (n.kind === "wait") return "gave up waiting for " + n.name + "; nothing was deleted"
  if (n.kind === "last" && pendingVerb === "deleting") return "gave up deleting " + n.name + "; it may be partly deleted"
  return "giving up on " + (pendingVerb || "it") + " — asking it to stop"
}

// Whether a list says the VM is down: absent counts as stopped (#49).
function isStopped(vms, name) {
  var list = vms || []
  for (var i = 0; i < list.length; i++)
    if (list[i] && list[i].name === name && list[i].running === true) return false
  return true
}

function unitFor(row) {
  if (!row || !isReportedName(row.name)) return ""
  if (row.kind === "disposable") return "nixarchy-vm-" + row.name + ".service"
  if (row.kind === "permanent") return "microvm@" + row.name + ".service"
  return ""
}

function statsArgv(units, system) {
  if (!units || !units.length) return null
  for (var i = 0; i < units.length; i++)
    if (!/^(nixarchy-vm-|microvm@)[A-Za-z0-9_-]+\.service$/.test(units[i])) return null
  return ["systemctl"].concat(system ? [] : ["--user"], ["show", "--timestamp=unix", "-p",
    "Id,ActiveState,MemoryCurrent,CPUUsageNSec,ActiveEnterTimestamp", "--"], Array.prototype.slice.call(units))
}

function parseUnitStats(text, atMs) {
  var out = {}
  var blocks = String(text || "").trim().split(/\n\s*\n/)
  for (var i = 0; i < blocks.length; i++) {
    var fields = {}
    var lines = blocks[i].split(/\r?\n/)
    for (var j = 0; j < lines.length; j++) {
      var at = lines[j].indexOf("=")
      if (at !== -1) fields[lines[j].substring(0, at)] = lines[j].substring(at + 1).trim()
    }
    if (fields.ActiveState !== "active" || !fields.Id) continue
    var mem = fields.MemoryCurrent
    var cpu = fields.CPUUsageNSec
    var since = (fields.ActiveEnterTimestamp || "").match(/^@(\d+(?:\.\d+)?)$/)
    out[fields.Id] = {
      mem: /^\d+$/.test(mem || "") ? Number(mem) : null,
      cpuNs: /^\d+$/.test(cpu || "") ? Number(cpu) : null,
      since: since && Number(since[1]) > 0 ? Number(since[1]) : null,
      atMs: atMs
    }
  }
  return out
}

function parseMeminfo(text) {
  var total = String(text || "").match(/^MemTotal:\s*(\d+)\s+kB\s*$/m)
  var available = String(text || "").match(/^MemAvailable:\s*(\d+)\s+kB\s*$/m)
  return total && available ? { totalKiB: Number(total[1]), availableKiB: Number(available[1]) } : null
}

function cpuPercent(prev, cur) {
  if (!prev || !cur || prev.cpuNs === null || prev.cpuNs === undefined ||
      cur.cpuNs === null || cur.cpuNs === undefined) return null
  var ms = cur.atMs - prev.atMs
  var ns = cur.cpuNs - prev.cpuNs
  return ms > 0 && ns >= 0 ? 100 * ns / (ms * 1e6) : null
}

function pushSample(list, value, cap) {
  var out = []
  var old = list || []
  for (var i = 0; i < old.length; i++) out.push(old[i])
  out.push(value)
  var limit = cap === undefined ? 30 : cap
  return limit > 0 ? out.slice(-limit) : []
}

function commitStats(state, side, parsed, running, atMs) {
  var stats = {}, history = {}, base = {}
  var keep = {}
  for (var i = 0; i < running.length; i++) keep[running[i]] = true
  var old = state || { stats: {}, history: {}, base: {} }
  for (var id in old.stats)
    if ((id.indexOf("microvm@") === 0 ? "system" : "user") !== side) stats[id] = old.stats[id]
  for (var h in old.history)
    if ((h.indexOf("microvm@") === 0 ? "system" : "user") !== side) history[h] = old.history[h]
  for (var b in old.base)
    if ((b.indexOf("microvm@") === 0 ? "system" : "user") !== side) base[b] = old.base[b]
  if (parsed) for (var unit in parsed) {
    if (!keep[unit] || (unit.indexOf("microvm@") === 0 ? "system" : "user") !== side) continue
    var prev = old.base[unit]
    // A restart (new start time, or a counter that went back) starts a fresh
    // history: samples from the previous run are not this run's (#53 review).
    var fresh = !prev || prev.since !== parsed[unit].since ||
      (prev.cpuNs !== null && parsed[unit].cpuNs !== null && parsed[unit].cpuNs < prev.cpuNs)
    stats[unit] = parsed[unit]
    history[unit] = pushSample(fresh ? [] : old.history[unit], fresh ? null : cpuPercent(prev, { cpuNs: parsed[unit].cpuNs, atMs: atMs }))
    base[unit] = { cpuNs: parsed[unit].cpuNs, atMs: atMs, since: parsed[unit].since }
  }
  return { stats: stats, history: history, base: base }
}

function cpuTrend(history) {
  var count = 0
  for (var i = 0; i < (history || []).length; i++) if (history[i] !== null) count++
  return count >= 2 ? history : []
}

// The latest sample only: an unknown reading now is "—", never an older figure (#53 review).
function cpuText(history) {
  var h = history || []
  var last = h.length ? h[h.length - 1] : null
  return last === null || last === undefined ? "—" : Math.round(last) + "%"
}

// The status line under a card's template, as VmList draws it (#53 review: out of QML).
function cardStatusText(row, rowPending, pendingVerb) {
  if (!row) return ""
  if (rowPending) return pendingVerb + "…"
  return row.up && !row.pending ? "" : (row.status || "")
}

// Sparkline points for a trend in a w x h box: scale is max(100, highest), so
// 100% (one core) is full height; a null sample breaks the line (#53 review).
function sparkPoints(trend, w, h) {
  var t = trend || []
  if (t.length < 2 || !(w > 0) || !(h > 0)) return []
  var top = 100
  for (var i = 0; i < t.length; i++) if (t[i] !== null && t[i] > top) top = t[i]
  var out = []
  var pen = false
  for (var j = 0; j < t.length; j++) {
    if (t[j] === null) { pen = false; continue }
    out.push({ x: j * w / (t.length - 1), y: h - 1 - (h - 2) * t[j] / top, move: !pen })
    pen = true
  }
  return out
}

function formatMemory(bytes) {
  if (bytes === null || bytes === undefined) return "—"
  return bytes < 1073741824 ? Math.round(bytes / 1048576) + " MiB" :
    (bytes / 1073741824).toFixed(1) + " GiB"
}

function formatUptime(sinceSec, nowMs) {
  if (sinceSec === null || sinceSec === undefined) return "—"
  var seconds = Math.max(0, nowMs / 1000 - sinceSec)
  if (seconds < 3600) return Math.floor(seconds / 60) + " min"
  if (seconds < 86400) return Math.floor(seconds / 3600) + " h"
  return Math.floor(seconds / 86400) + " d"
}

function overviewCard(row, stats, history, nowMs) {
  var id = unitFor(row)
  var running = row && row.runtime === "running"
  var stat = running && stats && stats[id]
  var config = row && row.memory ? "configured " + formatMemory(Number(row.memory) * 1048576) +
    (row.cores ? " · " + row.cores + " cores" : "") : ""
  if (row && row.pending) config = running ? "" : config + (config ? " (pending)" : "")
  var samples = history && history[id]
  return { running: !!running, memText: stat ? formatMemory(stat.mem) : "—",
    configText: config, uptimeText: stat ? formatUptime(stat.since, nowMs) : "—",
    cpuTrend: stat ? cpuTrend(samples) : [], cpuText: stat ? cpuText(samples) : "—",
    vitalsText: running ? "up " + (stat ? formatUptime(stat.since, nowMs) : "—") + " · " + (stat ? formatMemory(stat.mem) : "—") : "",
    cpuLabel: "cpu " + (stat ? cpuText(samples) : "—") }
}

function overviewSummaryText(rows, stats, meminfo, state) {
  if (!state.reachable) return "nixarchy-vm not found"
  if (state.upstreamError) return state.upstreamError
  if (state.listError) return "VM list failed: " + state.listError
  var c = counts(rows)
  var share = 0, readable = 0
  for (var i = 0; i < (rows || []).length; i++) {
    if (rows[i].runtime !== "running") continue
    var stat = stats && stats[unitFor(rows[i])]
    if (stat && stat.mem !== null && stat.mem !== undefined) {
      share += stat.mem
      readable++
    }
  }
  var used = meminfo ? formatMemory((meminfo.totalKiB - meminfo.availableKiB) * 1024) : "—"
  return "host " + used + " used · VMs " + (readable ? formatMemory(share) +
    (readable < c.running ? " (partial)" : "") : "—") + " · " + c.running + " running" +
    (c.pending > 0 ? " · " + c.pending + " pending" : "") +
    (c.failing > 0 ? " · " + c.failing + " failed" : "")
}

function removeWaitStep(wait, listOk, listGen, stopped, now) {
  if (now - wait.since >= 90000) return "timeout"
  if (listOk && listGen > wait.afterGen && stopped) return "rm"
  if (now - wait.since >= 30000 && !wait.resent) return "resend"
  return "wait"
}

// Ask "Apply now?" only after a permanent machine was written.
function offerApply(verb, key, failed) {
  return !failed && (verb === "creating" || verb === "editing") && String(key || "").indexOf("permanent:") === 0
}

function removeMessage(row, stateDir) {
  if (!row) return ""
  if (row.kind === "disposable") {
    var dir = trim(stateDir).replace(/\/+$/, "") + "/" + row.name
    if (row.runtime === "running") return "Stop and delete " + row.name + ", and everything in " + dir + "?"
    return "Delete " + row.name + " and everything in " + dir + "? Stop it first if it is running."
  }
  return "Remove " + row.name + " from ~/.config/nixarchy/apps.nix? The unit and /var/lib/microvms/" + row.name +
    " stay until you apply; this plugin never deletes VM state."
}

// ---------------------------------------------------------------- agent
//
// AI assist is one non-interactive call that returns a JSON object shaped
// by schema.json. The reply is data for the form: converted per field with
// the field's own type, validated as if typed, shown, and confirmed by the
// user. Nothing in it is executed. Only claude is called, because it is the
// one default agent with both a schema flag and a no-tools mode.

var AGENTS = ["claude"]

function agentFor(id) {
  var name = trim(id)
  return AGENTS.indexOf(name) !== -1 ? name : ""
}

// --restricted drops every code-running tool and ignores user settings;
// --strict-mcp-config keeps MCP servers out too; --tools "" leaves nothing.
// `prompt` is the whole text from agentPrompt, several lines; the user's
// own sentence was checked by the form (isDescribe) before it got here.
function agentArgv(id, schemaText, prompt) {
  if (agentFor(id) !== "claude" || !trim(schemaText) || !trim(prompt) || /\x00/.test(String(prompt))) return null
  return [
    "claude", "-p",
    "--output-format", "json",
    "--json-schema", String(schemaText),
    "--restricted", "--strict-mcp-config", "--tools", "",
    "--no-session-persistence",
    String(prompt)
  ]
}

// The prompt: the two kinds, the templates with their notes, the field
// ranges, and the request as data between tags. The request is one argv
// element and never touches a shell; the tags only tell the model where
// the user's words start and stop.
function agentPrompt(text, templates) {
  var lines = [
    "You fill in a form that creates a NixOS MicroVM on this desktop. Answer with one JSON object matching the schema you were given, and nothing else.",
    "",
    "Two kinds of VM:",
    "- disposable: created and destroyed freely, no root, no rebuild. Choose this unless the request asks for something below.",
    "- permanent: boots with the host under systemd, can forward an SSH port, has fixed memory and cores. Choose this when the request mentions boot, autostart, SSH, a port, or keeping the machine.",
    "",
    "Templates (use the name, not the label):"
  ]
  var list = templates || []
  for (var i = 0; i < list.length; i++) lines.push("- " + list[i].name + " (" + list[i].label + "): " + list[i].note)
  lines.push(
    "",
    "Fields: name is lower-case letters, digits and - (a permanent name) or letters, digits, _ and - (disposable), starting with a letter. memory is whole MiB from 256 to 131072 (1 GB = 1024). cores is 1 to 64. sshPort is null or 1024 to 65535. shares are host directories to mount inside the guest: use only paths the user named, expand ~ to the user's home literally as ~, and mount them under /mnt/<name>; never invent a path. Leave a field out rather than guess it.",
    "reasoning: one or two short sentences, at most 280 characters, saying why you chose the kind and the template.",
    "",
    "<request>",
    String(text),
    "</request>"
  )
  return lines.join("\n")
}

// Every balanced {…} in the text, as [start, end] with end past the closing
// brace. String-aware: a brace inside a JSON string is text, not depth, or
// `{"a":"}"}` comes back truncated. Unmatched `{` are dropped.
function braceSpans(text) {
  var s = String(text), stack = [], out = [], inString = false, escaped = false
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i)
    if (escaped) { escaped = false; continue }
    if (c === "\\") { if (inString) escaped = true; continue }
    if (c === "\"") { inString = !inString; continue }
    if (inString) continue
    if (c === "{") stack.push(i)
    else if (c === "}" && stack.length) out.push([stack.pop(), i + 1])
  }
  return out
}

var MAX_CANDIDATES = 64

function parseObject(text) {
  try {
    var v = JSON.parse(String(text))
    return v && typeof v === "object" && typeof v.length !== "number" ? v : null
  } catch (e) {
    return null
  }
}

// claude -p --output-format json prints one envelope: {type: "result",
// structured_output: {…}} with a schema, or {result: "<text>"} without
// one. Take the object either way; anything else is no answer.
function parseAgentReply(raw) {
  var text = trim(raw)
  var env = parseObject(text)
  if (!env) {
    // Prose around JSON: the outermost {…} that parses and looks like a
    // proposal. This runs on the UI thread from a .pragma library and the
    // reply is untrusted data, so the old nested loop -- JSON.parse over an
    // O(n) substring, twice nested -- froze both surfaces for 25 s on a 4 KB
    // reply. braceSpans is one linear string-aware pass; spans are tried
    // outermost-first, which is the order the old loop found them in.
    // ponytail: MAX_CANDIDATES is the ceiling on the parsing, not the scan.
    // Raise it if a real reply is ever found to need more than 64 candidates.
    var spans = braceSpans(text)
    spans.sort(function(a, b) { return a[0] - b[0] || b[1] - a[1] })
    var tried = spans.length < MAX_CANDIDATES ? spans.length : MAX_CANDIDATES
    for (var i = 0; i < tried; i++) {
      var candidate = parseObject(text.substring(spans[i][0], spans[i][1]))
      if (candidate && ("kind" in candidate || "name" in candidate)) return candidate
    }
    return null
  }
  if (env.structured_output && typeof env.structured_output === "object") return env.structured_output
  if (typeof env.result === "string") return parseObject(env.result)
  if ("kind" in env || "name" in env) return env
  return null
}

// Why an agent call failed, or "" when it did not. claude -p with
// --output-format json reports its own failures on stdout ({is_error, result},
// e.g. an expired login, exit 1); stderr then only has its stdin warning.
function agentFailure(stdout, stderr, code) {
  var env = parseObject(trim(stdout))
  if (env && env.is_error === true && typeof env.result === "string" && trim(env.result)) return sanitize(env.result, 160)
  if (code === 0) return parseAgentReply(stdout) ? "" : "the agent gave no usable answer"
  var err = String(stderr || "").split("\n").filter(function(l) { return !/no stdin data received/.test(l) }).join("\n")
  return errorText(err) || "the agent failed (exit " + code + ")"
}

var AGENT_FIELDS = {
  kind: "string", name: "string", template: "string",
  memory: "integer", cores: "integer", sshPort: "port", autostart: "boolean",
  shares: "shares", reasoning: "string"
}

// Per-field typed conversion into the form's own strings and bools. A value
// of the wrong type is dropped, not coerced; unknown keys are dropped. The
// caller then validates the form exactly as if the user had typed it.
function applyAgentReply(reply, form) {
  var f = {}
  for (var k in (form || {})) f[k] = form[k]
  var reasoning = ""
  var rejected = []
  var r = reply && typeof reply === "object" ? reply : {}
  for (var key in r) {
    if (!Object.prototype.hasOwnProperty.call(AGENT_FIELDS, key)) continue
    var type = AGENT_FIELDS[key]
    var v = r[key]
    if (type === "string") {
      if (typeof v !== "string") { rejected.push(key); continue }
      if (key === "reasoning") reasoning = sanitize(v, 280)
      else if (key === "kind") { if (KINDS.indexOf(v) !== -1) f.kind = v; else rejected.push(key) }
      else f[key] = sanitize(v, key === "name" ? 64 : 32)
    } else if (type === "integer") {
      if (typeof v !== "number" || v !== Math.floor(v)) { rejected.push(key); continue }
      f[key] = String(v)
    } else if (type === "port") {
      if (v === null) f.sshPort = ""
      else if (typeof v === "number" && v === Math.floor(v)) { f.sshPort = String(v); f.advanced = true }
      else rejected.push(key)
    } else if (type === "boolean") {
      if (typeof v !== "boolean") { rejected.push(key); continue }
      f.autostart = v
    } else if (type === "shares") {
      if (!v || typeof v.length !== "number") { rejected.push(key); continue }
      var pairs = []
      var bad = false
      for (var i = 0; i < v.length; i++) {
        var s = v[i]
        if (!s || typeof s.source !== "string" || typeof s.mountPoint !== "string") { bad = true; break }
        pairs.push(sanitize(s.source, 4096) + ":" + sanitize(s.mountPoint, 4096))
      }
      if (bad) rejected.push(key)
      else { f.shares = pairs.join(" "); if (pairs.length > 0) f.advanced = true }
    }
  }
  return { form: f, reasoning: reasoning, rejected: rejected }
}

// ---------------------------------------------------------------- host files
//
// The SSH keys the form can offer: every ~/.ssh/*.pub, one per line as
// "<file>\t<key line>", from one find. Only keys normalizeSshKey accepts
// are listed.

function sshKeysArgv(home) {
  var h = trim(home).replace(/\/+$/, "")
  return h ? ["find", h + "/.ssh", "-maxdepth", "1", "-name", "*.pub", "-printf", "\\n%f\\t", "-exec", "cat", "{}", ";"] : null
}

function parseSshKeys(raw) {
  var out = []
  var lines = String(raw || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var tab = lines[i].indexOf("\t")
    if (tab === -1) continue
    var key = normalizeSshKey(lines[i].substring(tab + 1))
    if (key) out.push({ file: sanitize(lines[i].substring(0, tab), 64), key: key })
  }
  return out
}

// What nixarchy-pkg's writers print: one JSON object whose `ok` says whether
// the file changed. The error text, or "" when it went through (or when the
// output is not one of its objects at all, so a plain writer's exit code
// still decides).
// ---------------------------------------------------------------- failure
//
// One place that turns a finished Process into a line for the user, so a
// failure cannot reach them as silence or as the wrong reason.

// The command a user would recognise. nixarchy.pkg's adapter is not on PATH
// and is invoked by its full store path, so it is named for what it is.
function commandName(argv) {
  var list = argv || []
  if (!list.length) return ""
  var first = String(list[0] || "")
  if (!first) return ""
  if (/\/nixarchy\.pkg\/bin\/nixarchy-pkg$/.test(first)) return "nixarchy-pkg"
  return first.split("/").pop()
}

// Why a command failed, in one line. A writer's own refusal wins over the exit
// code, because it says what the user did; reason is for a command that never
// ran at all, where there is no output to read.
function processFailure(info) {
  var f = info || {}
  var verb = trim(f.verb) || "the command"
  var subject = trim(f.key) ? verb + " " + trim(f.key) : verb
  if (trim(f.reason)) return subject + ": " + (trim(f.command) || "the command") + " " + trim(f.reason)
  var refused = trim(f.refused) || writerError(f.stdout)
  if (refused) return refused
  var text = errorText(f.stderr) || errorText(f.stdout)
  if (text) return text
  return subject + " failed (exit " + (f.code === undefined || f.code === null ? "?" : f.code) + ")"
}

// Feature detection is re-run on a schedule, not on every open: probing on
// each open re-spawned five processes a toggle, and Quickshell drops a command
// assigned to a Process that is still running.
function probeStale(now, probedAt) {
  if (!probedAt) return true
  return (now - probedAt) >= 600000
}

// Which reads are showing a value older than the last poll. Fixed order so the
// line is stable, empty when everything is current.
function staleList(flags) {
  var f = flags || {}
  var out = []
  if (f.vms) out.push("vms")
  if (f.units) out.push("units")
  if (f.pending) out.push("pending")
  if (f.help) out.push("help")
  return out
}

// The footer while a mutation runs. The escape is only ever offered for a hold
// the user can safely end, and only once it has run long enough to look stuck.
function workingText(info) {
  var f = info || {}
  var verb = trim(f.verb)
  if (!verb) return "working…"
  var text = "working… " + verb + (trim(f.key) ? " " + trim(f.key) : "")
  return f.escapable ? text + " — X gives up" : text
}

function writerError(stdout) {
  var obj = parseObject(trim(stdout))
  if (!obj || obj.ok !== false) return ""
  return sanitize(obj.error || obj.message || "refused", 200)
}
