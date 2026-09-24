// Proves the harness fails when it should. A broken harness cannot be caught
// by the tests it runs, so this runs on its own and checks the bookkeeping.
const harness = require("./harness.js")

harness.test("throws synchronously", () => { throw new Error("boom") })
harness.test("async that rejects", async () => { throw new Error("boom") })
harness.test("async that resolves", async () => { return 1 })

const counted = harness.failures.length
const code = harness.report()

if (counted !== 3) {
  console.error(`selftest: expected 3 failures, got ${counted}`)
  process.exitCode = 1
} else if (code !== 1) {
  console.error(`selftest: expected report() to return 1, got ${code}`)
  process.exitCode = 1
} else {
  console.log("selftest: the harness fails all three, and reports 1")
  process.exitCode = 0
}
