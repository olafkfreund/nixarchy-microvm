const { test, eq, Model } = require("../harness.js")

test("continueAfter routes process exits and holds the terminal phase", () => {
  const exit = { type: "exit", ok: true, phase: "create" }
  eq(Model.continueAfter(null, exit), { do: "done", next: null })
  eq(Model.continueAfter({ kind: "stream", name: "d1" }, exit),
    { do: "stream", name: "d1", next: { kind: "last", name: "d1" } })
  eq(Model.continueAfter({ kind: "rm", name: "d1" }, exit),
    { do: "rm", name: "d1", next: { kind: "last", name: "d1" } })
  const wait = { kind: "wait", name: "d1", since: 0, resent: false, afterGen: 1 }
  eq(Model.continueAfter(wait, exit), { do: "wait", next: wait })
  eq(Model.continueAfter({ kind: "last", name: "d1" }, exit), { do: "done", next: null })
})

test("continueAfter fails each process phase and ignores a failed stop resend", () => {
  for (const next of [null, { kind: "stream", name: "d1" }, { kind: "wait", name: "d1" },
    { kind: "rm", name: "d1" }, { kind: "last", name: "d1" }]) {
    eq(Model.continueAfter(next, { type: "exit", ok: false, phase: "stop" }),
      { do: "fail", message: "command failed", next: null })
  }
  const resend = { kind: "wait", name: "d1", since: 0, resent: true, resending: true, afterGen: 1 }
  eq(Model.continueAfter(resend, { type: "exit", ok: false, phase: "resend" }),
    { do: "wait", next: { kind: "wait", name: "d1", since: 0, resent: true, resending: false, afterGen: 1 } })
})

test("continueAfter tick needs a fresh successful stopped list", () => {
  const wait = { kind: "wait", name: "d1", since: 0, resent: false, afterGen: 4 }
  const tick = (listOk, listGen, stopped, now) =>
    Model.continueAfter(wait, { type: "tick", listOk, listGen, stopped, now })
  eq(tick(true, 4, true, 2000), { do: "wait", next: wait })
  eq(tick(false, 5, true, 2000), { do: "wait", next: wait })
  eq(tick(true, 5, false, 2000), { do: "wait", next: wait })
  eq(tick(true, 5, true, 2000), { do: "rm", name: "d1", next: { kind: "last", name: "d1" } })
  eq(tick(false, 5, false, 30000), { do: "stop", name: "d1", next: { kind: "wait", name: "d1", since: 0, resent: true, resending: true, afterGen: 4 } })
  eq(tick(true, 5, true, 90000), { do: "fail", message: "d1 did not stop within 90 s; nothing was deleted", next: null })
  for (const next of [null, { kind: "stream", name: "d1" }, { kind: "rm", name: "d1" }, { kind: "last", name: "d1" }])
    eq(Model.continueAfter(next, { type: "tick", now: 2000 }), { do: "fail", message: "invalid continuation step", next: null })
})

test("isStopped: running means not stopped; absent counts as stopped (#49 review)", () => {
  eq(Model.isStopped([{ name: "t1", running: true }], "t1"), false)
  eq(Model.isStopped([{ name: "t1", running: false }], "t1"), true)
  eq(Model.isStopped([{ name: "t2", running: true }], "t1"), true)
  eq(Model.isStopped({ length: 1, 0: { name: "t1", running: true } }, "t1"), false)
  eq(Model.isStopped(null, "t1"), true)
})

test("continueAfter: no second re-send, and a fresh stopped list wins over re-send (#49 review)", () => {
  const resent = { kind: "wait", name: "d1", since: 0, resent: true, afterGen: 1 }
  eq(Model.continueAfter(resent, { type: "tick", listOk: false, listGen: 0, stopped: false, now: 40000 }).do, "wait")
  const fresh = { kind: "wait", name: "d1", since: 0, resent: false, afterGen: 1 }
  eq(Model.continueAfter(fresh, { type: "tick", listOk: true, listGen: 2, stopped: true, now: 35000 }).do, "rm")
  // A clock-only tick (no fresh list) still re-sends on time.
  eq(Model.continueAfter(fresh, { type: "tick", listOk: false, listGen: 0, stopped: false, now: 31000 }).do, "stop")
})

test("abandonMessage: only the wait may promise nothing was deleted (#49 review)", () => {
  eq(Model.abandonMessage({ kind: "wait", name: "t1" }, "deleting"), "gave up waiting for t1; nothing was deleted")
  eq(Model.abandonMessage({ kind: "last", name: "t1" }, "deleting"), "gave up deleting t1; it may be partly deleted")
  eq(Model.abandonMessage({ kind: "last", name: "t1" }, "creating"), "giving up on creating — asking it to stop")
})

test("continueAfter: a successful re-send exit goes back to waiting (#49 review)", () => {
  const resend = { kind: "wait", name: "d1", since: 0, resent: true, resending: true, afterGen: 1 }
  eq(Model.continueAfter(resend, { type: "exit", ok: true, phase: "resend" }),
    { do: "wait", next: { kind: "wait", name: "d1", since: 0, resent: true, resending: false, afterGen: 1 } })
})
