// schema.json steers the model; Model.applyAgentReply is the gate. They must
// not name different fields, or the schema starts describing a boundary the
// code does not have — which is what #36 was about.
//
// Both sides are read by their own parser: the schema as JSON, AGENT_FIELDS
// through the harness's loader. No JavaScript is grepped out of Model.js and
// no list is generated at build time, so there is nothing to keep in step by
// hand.
const fs = require("fs")
const path = require("path")
const { Model } = require("./harness.js")

const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "schema.json"), "utf8"))
const failures = []
const fail = (line) => failures.push("schema-fields: " + line)

const schemaNames = Object.keys(SCHEMA.properties || {}).sort()
const fieldNames = Object.keys(Model.AGENT_FIELDS || {}).sort()

for (const name of schemaNames) {
  if (fieldNames.indexOf(name) === -1) fail(name + " is in schema.json but not in AGENT_FIELDS")
}
for (const name of fieldNames) {
  if (schemaNames.indexOf(name) === -1) fail(name + " is in AGENT_FIELDS but not in schema.json")
}

const enumKinds = ((SCHEMA.properties || {}).kind || {}).enum || []
if (JSON.stringify(enumKinds) !== JSON.stringify(Model.KINDS)) {
  fail("kind.enum is " + JSON.stringify(enumKinds) + " but KINDS is " + JSON.stringify(Model.KINDS))
}

for (const name of SCHEMA.required || []) {
  if (schemaNames.indexOf(name) === -1) fail("required names " + name + ", which is not a property")
}

// Not agent-settable, in either direction: the user types their own key.
if (schemaNames.indexOf("sshKey") !== -1 || fieldNames.indexOf("sshKey") !== -1) {
  fail("sshKey must not be agent-settable")
}

if (failures.length > 0) {
  for (const line of failures) console.error(line)
  process.exitCode = 1
} else {
  console.log("schema-fields: schema.json and AGENT_FIELDS name the same " + fieldNames.length + " fields")
  process.exitCode = 0
}
