pragma Singleton

import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// Everything the plugin knows about the two kinds of VM, and every way it
// talks to the machine. Nothing here draws.
//
// One instance for the bar and the menu (qmldir makes this a singleton), so
// that "one mutation at a time" holds across both surfaces and a log started
// in one is there to watch in the other.
Singleton {
  id: root

  // {refreshIntervalSec, showStopped, hideWhenEmpty, aiAssist}. Whichever
  // surface opened last writes it; both read the same bar entry, so they agree.
  property var settings: ({})

  readonly property int refreshIntervalSec: Math.max(5, Number(settings.refreshIntervalSec || 30))
  readonly property bool showStopped: settings.showStopped !== false
  readonly property bool aiAssist: settings.aiAssist !== false

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string configHome: Quickshell.env("XDG_CONFIG_HOME") || (home + "/.config")
  readonly property string stateHome: Quickshell.env("XDG_STATE_HOME") || (home + "/.local/state")
  readonly property string runtimeDir: Quickshell.env("XDG_RUNTIME_DIR") || "/tmp"
  readonly property string vmStateDir: stateHome + "/nixarchy/microvm"
  readonly property string schemaPath: Qt.resolvedUrl("schema.json").toString().replace(/^file:\/\//, "")

  // A token to prove from outside that every surface holds this one instance.
  readonly property string instanceId: Math.random().toString(36).substring(2, 10)

  // ------------------------------------------------------------ interest
  //
  // Surfaces say when they need data. A bar keeps the slow poll alive for its
  // glyph; an open view polls fast. Nothing polls when neither holds on.

  property int bars: 0
  property int views: 0
  readonly property bool background: bars > 0
  readonly property bool active: views > 0

  function acquire(kind) {
    if (kind === "bar") bars += 1
    else views += 1
  }

  function release(kind) {
    if (kind === "bar") bars = Math.max(0, bars - 1)
    else views = Math.max(0, views - 1)
  }

  // ------------------------------------------------------------ features
  //
  // Detected, never assumed. Probed once per open (and once for the bar).

  property bool vmJson: false
  property var features: ({ vmDetach: false, vmConsole: false, vmSetTemplate: false })
  // nixarchy.pkg's adapter, or "" when that plugin is not installed.
  property string pkgScript: ""
  property bool optReplace: false
  // services.nix has the microvm row (null until read), or
  // nixarchy-service-enable adds a missing one itself (nixarchy#843). #6.
  property var servicesRow: null
  property bool serviceHeals: false
  // The default agent this plugin can call ("claude"), or "".
  property string agent: ""
  property string agentId: ""
  property var templates: []
  property var sshKeys: []
  property bool probed: false

  readonly property var featureState: ({
    mutating: root.mutating,
    vmDetach: root.features.vmDetach === true,
    vmConsole: root.features.vmConsole === true,
    vmSetTemplate: root.features.vmSetTemplate === true,
    pkgScript: root.pkgScript,
    optReplace: root.optReplace,
    agent: root.agent,
    aiAssist: root.aiAssist,
    serviceQueued: root.pending.service === true,
    servicesRow: root.serviceHeals ? true : root.servicesRow
  })

  function probe() {
    root.probed = true
    templatesProcess.command = Model.templatesArgv()
    templatesProcess.running = true
    helpProcess.command = Model.helpArgv()
    helpProcess.running = true
    agentProbe.command = Model.defaultAgentArgv()
    agentProbe.running = true
    var keys = Model.sshKeysArgv(root.home)
    if (keys) { keysProcess.command = keys; keysProcess.running = true }
    pkgFile.reload()
    serviceHelpProbe.command = Model.serviceHelpArgv()
    serviceHelpProbe.running = true
  }

  // ---------------------------------------------------------------- data

  property var vms: []
  property var units: []
  property var machines: []
  property var pending: ({ ok: false, machines: {}, service: false })

  readonly property var allRows: Model.rowsFor(
    Model.disposableRows(root.vms).concat(Model.permanentRows(root.units, root.machines, root.pending)))
  readonly property var rows: root.showStopped ? root.allRows : root.allRows.filter(function(r) { return r.runtime === "running" })
  readonly property var counts: Model.counts(root.allRows)

  property bool reachable: true
  property bool loading: false
  property bool everLoaded: false
  property string lastError: ""
  // How many list queries have run: the `status` hook reports it, so "does it
  // poll while closed" can be measured from outside rather than assumed.
  property int polls: 0

  // ------------------------------------------------------------ the lock

  property string pendingKey: ""
  property string pendingVerb: ""
  // Follow-up commands of a multi-step action (create permanent = enable the
  // service, then write the line).
  property var queue: []
  readonly property bool mutating: actionProcess.running || streamProcess.running || queue.length > 0

  // --------------------------------------------------------------- stream

  property var log: []
  property string streamTitle: ""
  property string streamKey: ""
  property int streamExit: -1
  readonly property bool streaming: streamProcess.running

  // ---------------------------------------------------------------- agent

  readonly property bool thinking: agentProcess.running
  property string reasoning: ""
  property var agentForm: null
  property string agentError: ""

  // -------------------------------------------------------------- refresh

  function refresh() {
    if (!root.probed) root.probe()
    if (!listProcess.running) {
      root.loading = true
      root.polls += 1
      listProcess.command = Model.listArgv()
      listProcess.running = true
    }
    if (!unitsProcess.running) {
      unitsProcess.command = Model.unitsArgv()
      unitsProcess.running = true
    }
    if (root.active && root.pkgScript && !pendingProcess.running) {
      pendingProcess.command = Model.pendingArgv(root.pkgScript)
      pendingProcess.running = true
    }
  }

  Timer {
    interval: root.refreshIntervalSec * 1000
    running: root.background || root.active
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  Timer {
    interval: 3000
    running: root.active
    repeat: true
    onTriggered: root.refresh()
  }

  onActiveChanged: if (active) { root.probe(); refresh() }
  onShowStoppedChanged: if (root.active || root.background) root.refresh()

  // -------------------------------------------------------------- actions

  // A "Busy: …" refusal is about the operation that held the lock; once that
  // ends, the notice is wrong, so every exit handler drops it.
  function clearBusyNotice() {
    if (root.lastError.indexOf("Busy: ") === 0) root.lastError = ""
  }

  function busyText() {
    if (streamProcess.running) return "Busy: " + root.streamTitle + " — press o to watch"
    return "Busy: " + root.pendingVerb + (root.pendingKey ? " " + root.pendingKey.split(":")[1] : "") + " — wait for it to finish"
  }

  // Only rows the lists reported. A name typed from outside (IPC) that is
  // not in the list never reaches a command.
  function known(kind, name) {
    var row = Model.rowByName(root.allRows, kind, name)
    if (row) return row
    root.lastError = "No " + kind + " VM called " + name
    return null
  }

  function launch(proc, argv) {
    proc.stdinEnabled = true
    proc.command = argv
    proc.running = true
    proc.write("n\n")
    proc.stdinEnabled = false
  }

  // Every mutation comes through here. Refuses, with a reason, while anything
  // else mutates; the argv is null when an input failed validation.
  function run(argvs, verb, key) {
    if (root.mutating) { root.lastError = root.busyText(); return false }
    if (!argvs || argvs.length === 0) return false
    for (var i = 0; i < argvs.length; i++) if (!argvs[i]) return false
    root.lastError = ""
    root.pendingVerb = verb
    root.pendingKey = key || ""
    root.queue = argvs.slice(1)
    root.launch(actionProcess, argvs[0])
    return true
  }

  // The row verbs. Each takes a row the list produced and asks actionsFor
  // whether the verb applies, so IPC and buttons obey the same table.
  function allowed(row, verb) {
    var a = Model.actionFor(row, root.featureState, verb)
    if (!a) return false
    if (!a.enabled) { root.lastError = root.busyText(); return false }
    return true
  }

  function start(row) {
    if (!allowed(row, "start")) return false
    if (row.kind === "permanent") return run([Model.unitArgv("start", row.name)], "starting", row.key)
    return startStream(Model.runDetachArgv(row.name), "run " + row.name, row.key)
  }

  function stop(row) {
    if (!allowed(row, "stop")) return false
    var argv = row.kind === "permanent" ? Model.unitArgv("stop", row.name) : Model.stopVmArgv(row.name)
    return run([argv], "stopping", row.key)
  }

  function restart(row) {
    return allowed(row, "restart") && run([Model.unitArgv("restart", row.name)], "restarting", row.key)
  }

  function remove(row) {
    if (!allowed(row, "remove")) return false
    var argv = row.kind === "permanent" ? Model.optRemoveArgv(row.name) : Model.rmVmArgv(row.name)
    return run([argv], "deleting", row.key)
  }

  // A submitted form: create (one or two commands) or edit (one).
  function submit(form) {
    var argvs = Model.submitArgvs(form, root.allRows, root.templates, root.home, root.featureState)
    if (!argvs) { root.lastError = Model.permanentBlocked(form, root.featureState) || "Nothing was written: the form or a needed feature is missing"; return false }
    return run(argvs, form.editing ? "editing" : "creating", Model.rowKey(form.kind, form.name))
  }

  function startStream(argv, title, key) {
    if (root.mutating) { root.lastError = root.busyText(); return false }
    if (!argv) return false
    root.lastError = ""
    root.streamTitle = title
    root.streamKey = key || ""
    root.streamExit = -1
    root.log = ["$ " + title]
    root.launch(streamProcess, argv)
    return true
  }

  function appendLog(line) {
    var next = root.log.slice()
    next.push(Model.capLine(Model.stripAnsi(line)))
    if (next.length > 400) next.splice(0, next.length - 400)
    root.log = next
  }

  // ----------------------------------------------------------- side effects
  //
  // Terminals. None of these is tracked: the terminal owns the process.

  // Said once per session, the first time a VM is started in a terminal.
  property string notice: ""
  property bool terminalNoticeShown: false

  function detach(argv) {
    if (!argv) return false
    Quickshell.execDetached(argv)
    return true
  }

  function console_(row) {
    if (!Model.actionFor(row, root.featureState, "console")) return false
    return detach(row.kind === "permanent" ? Model.sshArgv(row.sshPort, row.sshKey, root.sshKeys, root.home) : Model.consoleArgv(row.name))
  }

  // "Start in terminal": today's `nixarchy vm run`, held by that terminal.
  function startTerminal(row) {
    if (!allowed(row, "startTerminal")) return false
    if (!root.terminalNoticeShown) {
      root.terminalNoticeShown = true
      root.notice = "started in a terminal: it builds and boots there, and closing that terminal stops the VM"
    }
    return detach(Model.runTerminalArgv(row.name))
  }

  function logs(row) {
    return !!Model.actionFor(row, root.featureState, "logs") && detach(Model.logsArgv(row.name))
  }

  function apply() {
    return detach(Model.applyTerminalArgv())
  }

  function copyName(name) {
    var argv = Model.copyArgv(name)
    if (!argv || copyProcess.running) return
    copyProcess.command = argv
    copyProcess.running = true
  }

  // ---------------------------------------------------------------- agent

  property string schemaText: ""

  function askAgent(prompt) {
    if (agentProcess.running || !root.agent || !root.schemaText) return false
    if (!Model.isDescribe(prompt) || !Model.trim(prompt)) { root.agentError = "Describe the VM in one line of at most 500 characters"; return false }
    var argv = Model.agentArgv(root.agent, root.schemaText, Model.agentPrompt(prompt, root.templates))
    if (!argv) return false
    root.agentError = ""
    root.reasoning = ""
    root.agentForm = null
    agentProcess.workingDirectory = root.runtimeDir
    agentProcess.command = argv
    agentProcess.running = true
    agentTimer.restart()
    return true
  }

  function cancelAgent() {
    if (!agentProcess.running) return
    agentTimer.stop()
    agentProcess.running = false
    root.agentError = "cancelled"
  }

  Timer {
    id: agentTimer
    interval: 90000
    onTriggered: {
      if (!agentProcess.running) return
      agentProcess.running = false
      root.agentError = "the agent took too long (90 s)"
    }
  }

  function statusJson() {
    return JSON.stringify({
      instance: root.instanceId,
      bars: root.bars,
      views: root.views,
      polls: root.polls,
      mutating: root.mutating,
      pending: root.pendingVerb + (root.pendingKey ? " " + root.pendingKey : ""),
      streaming: root.streaming,
      stream: root.streamTitle,
      thinking: root.thinking,
      vmJson: root.vmJson,
      features: root.features,
      pkgScript: root.pkgScript,
      optReplace: root.optReplace,
      agent: root.agentId,
      agentSupported: root.agent !== "",
      schemaLoaded: root.schemaText !== "",
      agentError: root.agentError,
      templates: Model.templateNames(root.templates),
      rows: root.allRows.map(function(r) { return r.key + " " + r.runtime + " " + r.ownership + (r.pending ? " pending" : "") }),
      lastError: root.lastError
    })
  }

  // ------------------------------------------------------------ processes

  Process {
    id: listProcess
    stdout: StdioCollector { id: listOut; waitForEnd: true }
    stderr: StdioCollector { id: listErr; waitForEnd: true }

    onExited: function(code) {
      root.loading = false
      root.everLoaded = true
      if (code !== 0) {
        root.reachable = false
        root.vms = []
        return
      }
      root.reachable = true
      root.vmJson = Model.isJsonList(listOut.text)
      root.vms = Model.parseVmList(listOut.text)
    }
  }

  Process {
    id: unitsProcess
    stdout: StdioCollector { id: unitsOut; waitForEnd: true }
    onExited: function(code) { root.units = code === 0 ? Model.parseUnits(unitsOut.text) : [] }
  }

  Process {
    id: pendingProcess
    stdout: StdioCollector { id: pendingOut; waitForEnd: true }
    onExited: function(code) { root.pending = Model.parsePending(pendingOut.text) }
  }

  Process {
    id: templatesProcess
    stdout: StdioCollector { id: templatesOut; waitForEnd: true }
    onExited: function(code) { if (code === 0) root.templates = Model.parseTemplates(templatesOut.text) }
  }

  Process {
    id: helpProcess
    stdout: StdioCollector { id: helpOut; waitForEnd: true }
    onExited: function(code) { root.features = Model.detectFeatures(helpOut.text) }
  }

  Process {
    id: optProbe
    stdout: StdioCollector { id: optOut; waitForEnd: true }
    onExited: function(code) { root.optReplace = Model.optReplaceSupported(optOut.text) }
  }

  // Today --help is taken as a service id: it only greps and complains, on
  // stderr, and writes nothing.
  Process {
    id: serviceHelpProbe
    stdout: StdioCollector { id: serviceHelpOut; waitForEnd: true }
    stderr: StdioCollector { id: serviceHelpErr; waitForEnd: true }
    onExited: function(code) { root.serviceHeals = Model.serviceEnableHeals(serviceHelpOut.text + "\n" + serviceHelpErr.text) }
  }

  Process {
    id: agentProbe
    stdout: StdioCollector { id: agentOut; waitForEnd: true }
    onExited: function(code) {
      root.agentId = code === 0 ? Model.sanitize(agentOut.text, 32) : ""
      root.agent = Model.agentFor(root.agentId)
    }
  }

  Process {
    id: keysProcess
    stdout: StdioCollector { id: keysOut; waitForEnd: true }
    onExited: function(code) { root.sshKeys = Model.parseSshKeys(keysOut.text) }
  }

  // nixarchy.pkg's adapter is found by reading it: a plugin that is not
  // installed has no file there, and every feature that needs it hides.
  FileView {
    id: pkgFile
    path: Model.pkgScriptPath(root.configHome)
    printErrors: false
    onLoaded: {
      root.pkgScript = path
      optProbe.command = Model.optProbeArgv(path)
      optProbe.running = true
    }
    onLoadFailed: { root.pkgScript = ""; root.optReplace = false }
  }

  // The permanent machines this plugin may edit, straight from the file
  // nixarchy.pkg writes. Watched, so a line written by that plugin, or by
  // hand, shows up without a poll.
  FileView {
    id: appsFile
    path: root.configHome + "/nixarchy/apps.nix"
    watchChanges: true
    printErrors: false
    onLoaded: root.machines = Model.parseMachineLines(text())
    onLoadFailed: root.machines = []
    onFileChanged: reload()
  }

  // Watched like apps.nix, so pasting the row clears the warning at once.
  FileView {
    id: servicesFile
    path: root.configHome + "/nixarchy/services.nix"
    watchChanges: true
    printErrors: false
    onLoaded: root.servicesRow = Model.servicesHasMicrovm(text())
    onLoadFailed: root.servicesRow = false
    onFileChanged: reload()
  }

  FileView {
    id: schemaFile
    path: root.schemaPath
    printErrors: false
    onLoaded: root.schemaText = text()
  }

  Process {
    id: actionProcess
    stdout: StdioCollector { id: actionOut; waitForEnd: true }
    stderr: StdioCollector { id: actionErr; waitForEnd: true }

    onExited: function(code) {
      // nixarchy-pkg's writers exit 0 and say no in JSON instead.
      var refused = Model.writerError(actionOut.text)
      var failed = code !== 0 || refused !== ""
      if (root.queue.length === 0 || failed) root.clearBusyNotice()
      if (failed) {
        var why = refused || Model.errorText(actionErr.text) || (root.pendingVerb + " failed (exit " + code + ")")
        // The service row went through but the line did not: say both.
        if (root.pendingVerb === "creating" && root.queue.length === 0 && root.pendingKey.indexOf("permanent:") === 0)
          why = "service queued, machine not written: " + why + " (a service with no machines is inert)"
        root.lastError = why
        root.queue = []
      }
      if (root.queue.length > 0) {
        // Started on the next tick, not from inside this process's own exit.
        // The queue is only consumed in the same synchronous step that starts
        // the next command, so `mutating` never drops between the two.
        Qt.callLater(function() {
          var next = root.queue[0]
          root.queue = root.queue.slice(1)
          root.launch(actionProcess, next)
        })
        return
      }
      root.pendingVerb = ""
      root.pendingKey = ""
      if (root.active || root.background) root.refresh()
    }
  }

  Process {
    id: streamProcess
    stdout: SplitParser { onRead: function(line) { root.appendLog(line) } }
    stderr: SplitParser { onRead: function(line) { root.appendLog(line) } }

    onExited: function(code) {
      root.clearBusyNotice()
      root.streamExit = code
      root.appendLog("── exit " + code + " · " + (code === 0 ? "done" : "failed"))
      if (code !== 0) root.lastError = root.streamTitle + " failed (exit " + code + ") — o shows the log"
      if (root.active || root.background) root.refresh()
    }
  }

  Process {
    id: agentProcess
    stdout: StdioCollector { id: agentReplyOut; waitForEnd: true }
    stderr: StdioCollector { id: agentReplyErr; waitForEnd: true }

    onExited: function(code) {
      agentTimer.stop()
      if (root.agentError === "cancelled") return
      var reply = code === 0 ? Model.parseAgentReply(agentReplyOut.text) : null
      if (!reply) {
        root.agentError = code === 0 ? "the agent gave no usable answer"
          : (Model.errorText(agentReplyErr.text) || "the agent failed (exit " + code + ")")
        return
      }
      root.agentForm = reply
    }
  }

  Process { id: copyProcess }
}
