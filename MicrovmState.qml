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

  // Every action waits for both probes; one verdict says what to update.
  property bool helpDone: false
  property bool optDone: false
  property bool pkgDone: false
  property string helpText: ""
  property string optReply: ""
  property bool listTooOld: false
  // nixarchy.pkg's adapter, or "" when that plugin is not installed.
  property string pkgScript: ""
  readonly property bool upstreamReady: helpDone && pkgDone && (optDone || !pkgScript)
  readonly property string upstreamError: listTooOld
    ? Model.upstreamVerdict("", "", false)   // the nixarchy#762 message: list --json came with it
    : (upstreamReady ? Model.upstreamVerdict(helpText, optReply, !!pkgScript) : "")
  // services.nix has the microvm row (null until read), or
  // nixarchy-service-enable adds a missing one itself (nixarchy#843). #6.
  property var servicesRow: null
  property bool serviceHeals: false
  // The default agent this plugin can call ("claude"), or "".
  property string agent: ""
  property string agentId: ""
  property var templates: []
  property var sshKeys: []

  readonly property var featureState: ({
    mutating: root.mutating,
    upstreamOk: root.upstreamReady && root.upstreamError === "",
    upstreamError: root.upstreamError,
    pkgScript: root.pkgScript,
    agent: root.agent,
    aiAssist: root.aiAssist,
    schemaLoaded: root.schemaText !== "",
    serviceQueued: root.pending.service === true,
    pendingSync: root.pendingSync,
    servicesRow: root.serviceHeals ? true : root.servicesRow
  })

  // When the last probe ran. Every spawn is guarded: assigning .command to a
  // Process that is still running has its command silently dropped.
  property double probedAt: 0

  function probe() {
    root.probedAt = Date.now()
    if (!templatesProcess.running) { templatesProcess.command = Model.templatesArgv(); templatesProcess.running = true }
    if (!helpProcess.running) { helpProcess.command = Model.helpArgv(); helpProcess.running = true }
    if (!agentProbe.running) { agentProbe.command = Model.defaultAgentArgv(); agentProbe.running = true }
    var keys = Model.sshKeysArgv(root.home)
    if (keys && !keysProcess.running) { keysProcess.command = keys; keysProcess.running = true }
    pkgFile.reload()
    if (!serviceHelpProbe.running) { serviceHelpProbe.command = Model.serviceHelpArgv(); serviceHelpProbe.running = true }
  }

  // ---------------------------------------------------------------- data

  property var vms: []
  property var units: []
  property var machines: []
  property var pending: ({ ok: false, machines: {}, service: false })
  property bool pendingSync: false
  property int appsGen: 0
  property int pendingGen: 0
  property string appsText: ""

  readonly property var allRows: Model.rowsFor(
    Model.disposableRows(root.vms).concat(Model.permanentRows(root.units, root.machines, root.pending)))
  readonly property var rows: root.showStopped ? root.allRows : root.allRows.filter(function(r) { return r.runtime === "running" })
  readonly property var counts: Model.counts(root.allRows)

  property bool reachable: true
  property bool loading: false
  property bool everLoaded: false
  // A poll that failed after a good one keeps its rows and says so.
  property bool listOk: false
  property bool vmsStale: false
  property string listError: ""
  property string lastError: ""
  // How many list queries have run: the `status` hook reports it, so "does it
  // poll while closed" can be measured from outside rather than assumed.
  property int polls: 0

  // ------------------------------------------------------------ the lock

  property string pendingKey: ""
  property string pendingVerb: ""
  // The command currently owed an exit, so a failure can name it. Set at every
  // launch rather than read from queue[0], which holds the remainder after the
  // slice and so names the culprit's successor.
  property string pendingCommand: ""
  // Offered only once a hold owned by a running Process has looked stuck for a
  // minute. Never set for streamProcess: a build the user can watch in the log
  // is not stuck, it is slow.
  property bool escapable: false
  // A read that failed and kept its last value, rather than pretending the
  // world changed.
  property bool unitsStale: false
  property bool pendingStale: false
  property bool helpStale: false
  // Follow-up commands of a multi-step action (create permanent = enable the
  // service, then write the line).
  property var queue: []
  property var next: null
  property bool abandoning: false
  readonly property bool mutating: actionProcess.running || streamProcess.running || queue.length > 0 || next !== null

  // --------------------------------------------------------------- stream

  property var log: []
  property string streamTitle: ""
  property int streamExit: -1
  readonly property bool streaming: streamProcess.running

  // ---------------------------------------------------------------- agent

  readonly property bool thinking: agentProcess.running
  property string reasoning: ""
  property var agentForm: null
  property string agentError: ""

  // -------------------------------------------------------------- refresh

  function refresh() {
    if (Model.probeStale(Date.now(), root.probedAt)) root.probe()
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
    root.readPending()
  }

  function readPending() {
    if (!root.active || !root.pkgScript || pendingProcess.running) return
    root.pendingGen = root.appsGen
    pendingProcess.command = Model.pendingArgv(root.pkgScript)
    pendingProcess.running = true
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

  onActiveChanged: {
    if (active) refresh()
    else pendingSync = false
  }
  onShowStoppedChanged: if (root.active || root.background) root.refresh()

  // -------------------------------------------------------------- actions

  // A "Busy: …" refusal is about the operation that held the lock; once that
  // ends, the notice is wrong, so every exit handler drops it.
  function clearBusyNotice() {
    if (root.lastError.indexOf("Busy: ") === 0) root.lastError = ""
  }

  function busyText() {
    if (streamProcess.running) return "Busy: " + root.streamTitle + " — press o to watch"
    return "Busy: " + root.pendingVerb + (root.pendingKey ? " " + Model.pendingName(root.pendingKey) : "") + " — wait for it to finish"
  }

  function launch(proc, argv) {
    root.pendingCommand = Model.commandName(argv)
    if (root.next === null) {
      root.escapable = false
      escapeTimer.stop()
      if (proc === actionProcess) escapeTimer.restart()
    }
    proc.stdinEnabled = true
    proc.command = argv
    proc.running = true
    proc.write("n\n")
    proc.stdinEnabled = false
  }

  // Every mutation comes through here. Refuses, with a reason, while anything
  // else mutates; the argv is null when an input failed validation.
  function run(argvs, verb, key, nextStep) {
    if (!root.featureState.upstreamOk) { root.lastError = root.upstreamError || "checking nixarchy…"; return false }
    if (root.mutating) { root.lastError = root.busyText(); return false }
    if (!argvs || argvs.length === 0) return false
    for (var i = 0; i < argvs.length; i++) if (!argvs[i]) return false
    root.lastError = ""
    root.next = nextStep || null
    root.abandoning = false
    root.pendingVerb = verb
    root.pendingKey = key || ""
    root.queue = argvs.slice(1)
    escapeTimer.restart()
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
    return startStream(Model.runDetachArgv(row.name), "run " + row.name)
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
  property string submitOwner: ""

  function submit(form, owner) {
    if (!root.featureState.upstreamOk) { root.lastError = root.upstreamError || "checking nixarchy…"; return false }
    var argvs = Model.submitArgvs(form, root.allRows, root.templates, root.home, root.featureState)
    if (!argvs) { root.lastError = Model.permanentBlocked(form, root.featureState) || "Nothing was written: the form or a needed feature is missing"; return false }
    var key = Model.rowKey(form.kind, form.name)
    var name = Model.startAfterCreate(form)
    if (!name) {
      if (!run(argvs, form.editing ? "editing" : "creating", key)) return false
      root.submitOwner = owner || ""   // step 8's Apply now asks only the submitting surface
      return true
    }
    if (!run(argvs, "creating", key, { kind: "stream", name: name })) return false
    root.submitOwner = owner || ""
    root.streamTitle = "create " + name
    root.streamExit = -1
    root.log = ["$ create " + name]
    root.pendingLines = []
    return true
  }

  function beginStream(argv, title, keepLog) {
    root.lastError = ""
    root.streamTitle = title
    root.streamExit = -1
    root.log = keepLog ? Model.capLog(root.log, ["$ " + title]) : ["$ " + title]
    root.pendingLines = []
    root.launch(streamProcess, argv)
    return true
  }

  function startStream(argv, title) {
    if (root.mutating) { root.lastError = root.busyText(); return false }
    if (!argv) return false
    return root.beginStream(argv, title, false)
  }

  function advance(decision) {
    if (root.next === null) return
    var step = decision || Model.continueAfter(root.next, { type: "exit", ok: true, phase: "advance" })
    if (step.do === "stream") root.beginStream(Model.runDetachArgv(step.name), "run " + step.name, true)
    else if (step.do === "rm") root.launch(actionProcess, Model.rmVmArgv(step.name))
    else if (step.do === "stop") root.launch(actionProcess, Model.stopVmArgv(step.name))
    else if (step.do === "wait") waitTimer.restart()
    else if (step.do === "fail") root.lastError = step.message
    root.next = step.next
  }

  // A nix build emits thousands of lines. Appending each one reassigned a var
  // property and copied the whole capped array, so every line cost a full
  // LogView model invalidation. Buffer the raw lines and merge once per tick.
  property var pendingLines: []

  function appendLog(line) {
    root.pendingLines.push(line)
    Qt.callLater(root.flushLog)
  }

  // Qt.callLater defers past the current script execution, so a scheduled flush
  // can never run *between* two synchronous emissions from one C++ call.
  // Process::onFinished emits streamEnded (hence onRead, hence appendLog, hence
  // only a scheduled flush) and then exited, both inside itself -- so when
  // onExited runs, the tail line is still buffered and its direct flushLog()
  // drains the tail and the marker in order. The scheduled call fires later and
  // returns early.
  function flushLog() {
    if (root.pendingLines.length === 0) return
    root.log = Model.capLog(root.log, root.pendingLines)
    root.pendingLines = []
  }

  // A queue with nothing running is a hold no exit will ever release: the
  // command was launched and never started. Provably inert — there is no child
  // to collide with — so clearing it cannot produce two mutations at once. If
  // Quickshell does emit exited on a failed exec, this never arms for 5 s and
  // the timer is dead code.
  // The other half of the lock: a hold owned by a running Process. No timer
  // ever clears it — only the user, and only after the child is dead. abandon()
  // signals and returns; the existing onExited releases the lock when the kernel
  // says the process is gone, so a release can never race a live opt set.
  Timer { id: escapeTimer; interval: 60000; onTriggered: root.escapable = true }
  Timer { id: killTimer; interval: 3000; onTriggered: if (actionProcess.running) actionProcess.signal(9) }
  Timer { id: waitTimer; interval: 2000 }
  Timer { id: deadlineTimer; interval: 90000 }

  function abandon() {
    if (!actionProcess.running && root.next === null) return
    if (root.next !== null) {
      var waiting = root.next.kind === "wait" || root.next.kind === "rm" || (root.next.kind === "last" && root.pendingVerb === "deleting")
      var name = root.next.name
      waitTimer.stop()
      deadlineTimer.stop()
      root.next = null
      root.lastError = waiting ? "gave up waiting for " + name + "; nothing was deleted" : "giving up on " + root.pendingVerb + " — asking it to stop"
      root.abandoning = true
    } else root.lastError = "giving up on " + root.pendingVerb + " — asking it to stop"
    if (actionProcess.running) {
      actionProcess.signal(15)
      killTimer.restart()
    } else {
      root.pendingVerb = ""
      root.pendingKey = ""
      root.escapable = false
      escapeTimer.stop()
    }
  }

  Timer {
    id: queueWatchdog
    interval: 5000
    running: root.queue.length > 0 && !actionProcess.running && !streamProcess.running
    onTriggered: {
      root.queue = []
      root.lastError = Model.processFailure({
        verb: root.pendingVerb, key: Model.pendingName(root.pendingKey),
        command: root.pendingCommand, reason: "did not start"
      })
      root.pendingVerb = ""
      root.pendingKey = ""
    }
  }

  // ----------------------------------------------------------- side effects
  //
  // Terminals. None of these is tracked: the terminal owns the process.

  function detach(argv) {
    if (!argv) return false
    Quickshell.execDetached(argv)
    return true
  }

  function console_(row) {
    if (!Model.actionFor(row, root.featureState, "console")) return false
    return detach(row.kind === "permanent" ? Model.sshArgv(row.sshPort, row.sshKey, root.sshKeys, root.home) : Model.consoleArgv(row.name))
  }

  function logs(row) {
    return !!Model.actionFor(row, root.featureState, "logs") && detach(Model.logsArgv(row.name))
  }

  function apply() {
    if (!root.featureState.upstreamOk) { root.lastError = root.upstreamError || "checking nixarchy…"; return false }
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

  // Which surface's call this is: the bar and the menu share this singleton, so
  // without an owner a reply landed in whichever form was open.
  property string agentOwner: ""

  function agentBusyFor(owner) { return agentProcess.running && root.agentOwner !== owner }

  function askAgent(prompt, owner) {
    if (root.agentBusyFor(owner)) return "busy"
    root.agentOwner = owner
    // Every refusal says why. Returning a bare false left the user pressing i
    // and watching nothing happen, with no message anywhere.
    if (agentProcess.running) { root.agentError = "the agent is still thinking"; return false }
    if (!root.agent) { root.agentError = "no agent is configured"; return false }
    if (!root.schemaText) { root.agentError = "the plugin's schema.json could not be read, so assist is unavailable"; return false }
    if (!Model.isDescribe(prompt) || !Model.trim(prompt)) { root.agentError = "Describe the VM in one line of at most 500 characters"; return false }
    var argv = Model.agentArgv(root.agent, root.schemaText, Model.agentPrompt(prompt, root.templates))
    if (!argv) { root.agentError = "the agent could not be started"; return false }
    root.agentEnded = ""
    root.agentError = ""
    root.reasoning = ""
    root.agentForm = null
    agentProcess.workingDirectory = root.runtimeDir
    agentProcess.command = argv
    // Close claude's stdin at once, as launch() does: left open, claude waits
    // 3 s for input before it starts (#8).
    agentProcess.stdinEnabled = true
    agentProcess.running = true
    agentProcess.stdinEnabled = false
    agentTimer.restart()
    return true
  }

  // Why the call ended, as a flag rather than by matching on the message. The
  // string sentinel only covered cancellation, so a timeout's own message was
  // overwritten by the generic exit line that followed it.
  property string agentEnded: ""

  function cancelAgent(owner) {
    if (!agentProcess.running || root.agentOwner !== owner) return
    agentTimer.stop()
    root.agentEnded = "cancelled"
    agentProcess.running = false
    root.agentError = "cancelled"
  }

  // Ends a call and clears everything it produced. Called when the form is
  // left or a surface is dismissed — never from reset(), which must not touch
  // the stream or the log.
  function resetAgent(owner) {
    // Another surface's call, running or finished, is not this surface's to clear.
    if (root.agentOwner !== "" && root.agentOwner !== owner) return
    agentTimer.stop()
    if (agentProcess.running) {
      root.agentEnded = "closed"
      agentProcess.running = false
    }
    root.reasoning = ""
    root.agentForm = null
    root.agentError = ""
    root.agentOwner = ""
  }

  Timer {
    id: agentTimer
    interval: 90000
    onTriggered: {
      if (!agentProcess.running) return
      root.agentEnded = "timeout"
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
      upstreamError: root.upstreamError,
      pkgScript: root.pkgScript,
      agent: root.agentId,
      agentSupported: root.agent !== "",
      schemaLoaded: root.schemaText !== "",
      stale: Model.staleList({ vms: root.vmsStale, units: root.unitsStale, pending: root.pendingStale, help: root.helpStale }),
      command: root.pendingCommand,
      pid: actionProcess.processId,
      agentError: root.agentError,
      templates: Model.templateNames(root.templates),
      rows: root.allRows.map(function(r) { return r.key + " " + r.runtime + " " + r.ownership + (r.pending ? " pending" : "") }),
      lastError: root.lastError,
      listError: root.listError
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
        if (!root.listOk && Model.trim(listErr.text) === "") {
          root.reachable = false
          root.vms = []
          root.vmsStale = false
          root.listError = ""
        } else {
          root.reachable = true
          root.vmsStale = root.listOk
          root.listError = Model.listFailure(listErr.text, code)
        }
        return
      }
      root.listOk = true
      root.vmsStale = false
      root.listError = ""
      root.reachable = true
      root.listTooOld = Model.isTooOldList(listOut.text)
      root.vms = root.listTooOld ? [] : Model.parseVmList(listOut.text)
    }
  }

  Process {
    id: unitsProcess
    stdout: StdioCollector { id: unitsOut; waitForEnd: true }
    // A transient systemctl failure used to flip every permanent VM to
    // not-running for one poll, with no message. Keep the last good read and
    // say it is stale instead.
    onExited: function(code) {
      if (code === 0) { root.units = Model.parseUnits(unitsOut.text); root.unitsStale = false }
      else root.unitsStale = true
    }
  }

  Process {
    id: pendingProcess
    stdout: StdioCollector { id: pendingOut; waitForEnd: true }
    onExited: function(code) {
      if (root.pendingGen !== root.appsGen) {
        Qt.callLater(root.readPending)
        return
      }
      if (code === 0) { root.pending = Model.parsePending(pendingOut.text); root.pendingStale = false }
      else root.pendingStale = true
      root.pendingSync = false
    }
  }

  Process {
    id: templatesProcess
    stdout: StdioCollector { id: templatesOut; waitForEnd: true }
    onExited: function(code) { if (code === 0) root.templates = Model.parseTemplates(templatesOut.text) }
  }

  Process {
    id: helpProcess
    stdout: StdioCollector { id: helpOut; waitForEnd: true }
    stderr: StdioCollector { id: helpErr; waitForEnd: true }
    // Some tools print usage on stderr: read both.
    onExited: function(code) {
      var text = Model.trim(helpOut.text + "\n" + helpErr.text)
      if (text) { root.helpText = text; root.helpStale = false }
      else root.helpStale = true
      root.helpDone = true
    }
  }

  Process {
    id: optProbe
    stdout: StdioCollector { id: optOut; waitForEnd: true }
    onExited: function(code) { root.optReply = optOut.text; root.optDone = true }
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
      root.pkgDone = true
      root.optDone = false
      root.optReply = ""
      if (!optProbe.running) {
        optProbe.command = Model.optProbeArgv(path)
        optProbe.running = true
      }
    }
    onLoadFailed: { root.pkgScript = ""; root.optReply = ""; root.pkgDone = true }
  }

  // The permanent machines this plugin may edit, straight from the file
  // nixarchy.pkg writes. Watched, so a line written by that plugin, or by
  // hand, shows up without a poll.
  FileView {
    id: appsFile
    path: root.configHome + "/nixarchy/apps.nix"
    watchChanges: true
    printErrors: false
    onLoaded: {
      var contents = text()
      if (contents !== root.appsText) {
        root.appsText = contents
        if (root.active && root.pkgScript) {
          root.appsGen += 1
          root.pendingSync = true
          root.readPending()
        }
      }
      root.machines = Model.parseMachineLines(contents)
    }
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
    // Without this the schema silently stayed empty and askAgent refused for
    // ever, with the i key still on offer.
    onLoadFailed: root.schemaText = ""
  }

  Process {
    id: actionProcess
    stdout: StdioCollector { id: actionOut; waitForEnd: true }
    stderr: StdioCollector { id: actionErr; waitForEnd: true }

    onExited: function(code) {
      // nixarchy-pkg's writers exit 0 and say no in JSON instead.
      var refused = Model.writerError(actionOut.text)
      var failed = code !== 0 || refused !== ""
      if (root.next && root.next.kind === "stream")
        root.log = Model.capLog(root.log, (actionOut.text + "\n" + actionErr.text).split("\n").filter(function(l) { return l !== "" }))
      var decision = Model.continueAfter(root.next, { type: "exit", ok: !failed, phase: root.next && root.next.resending ? "resend" : root.pendingCommand })
      if (root.queue.length === 0 || failed) root.clearBusyNotice()
      if (failed && !root.abandoning && decision.do !== "wait") {
        var why = Model.processFailure({
          verb: root.pendingVerb, key: Model.pendingName(root.pendingKey),
          command: root.pendingCommand, code: code,
          stdout: actionOut.text, stderr: actionErr.text, refused: refused
        })
        // The service row went through but the line did not: say both.
        if (root.pendingVerb === "creating" && root.queue.length === 0 && root.pendingKey.indexOf("permanent:") === 0)
          why = "service queued, machine not written: " + why + " (a service with no machines is inert)"
        root.lastError = why
        root.queue = []
      }
      if (decision.do === "fail") root.next = null
      if (root.next === null) {
        root.escapable = false
        escapeTimer.stop()
      }
      killTimer.stop()
      if (root.abandoning) {
        root.abandoning = false
        root.pendingVerb = ""
        root.pendingKey = ""
        if (root.active || root.background) root.refresh()
        return
      }
      if (root.next !== null && root.queue.length === 0 && decision.do !== "fail") {
        Qt.callLater(function() { root.advance(decision) })
        return
      }
      if (root.queue.length > 0) {
        // Started on the next tick, not from inside this process's own exit.
        // The queue is only consumed in the same synchronous step that starts
        // the next command, so `mutating` never drops between the two.
        Qt.callLater(function() {
          // Launch before slicing, so the two holders of the lock overlap: a
          // late tick makes the plugin slow, never unsafe. Slicing first would
          // leave a window with an empty queue and no running Process.
          root.launch(actionProcess, root.queue[0])
          root.queue = root.queue.slice(1)
        })
        return
      }
      root.next = null
      root.pendingVerb = ""
      root.pendingKey = ""
      if (root.active || root.background) root.refresh()
    }
  }

  Process {
    id: streamProcess
    // The tail of a build that died mid-line is not lost: Process::onFinished
    // calls streamEnded() on both parsers before it emits exited
    // (quickshell src/io/process.cpp:274-282), and SplitParser::streamEnded
    // emits any non-empty buffer (src/io/datastream.cpp:97-99). So the fragment
    // arrives here, and only then does onExited append the marker.
    stdout: SplitParser { onRead: function(line) { root.appendLog(line) } }
    stderr: SplitParser { onRead: function(line) { root.appendLog(line) } }

    onExited: function(code) {
      root.clearBusyNotice()
      root.streamExit = code
      root.appendLog("── exit " + code + " · " + (code === 0 ? "done" : "failed"))
      root.flushLog()
      if (code !== 0) root.lastError = Model.processFailure({ verb: root.streamTitle, code: code }) + " — o shows the log"
      root.next = null
      root.pendingVerb = ""
      root.pendingKey = ""
      root.escapable = false
      escapeTimer.stop()
      if (root.active || root.background) root.refresh()
    }
  }

  Process {
    id: agentProcess
    stdout: StdioCollector { id: agentReplyOut; waitForEnd: true }
    stderr: StdioCollector { id: agentReplyErr; waitForEnd: true }

    onExited: function(code) {
      agentTimer.stop()
      if (root.agentEnded !== "") return
      var failure = Model.agentFailure(agentReplyOut.text, agentReplyErr.text, code)
      if (failure) {
        root.agentError = failure
        return
      }
      root.agentForm = Model.parseAgentReply(agentReplyOut.text)
    }
  }

  Process { id: copyProcess }
}
