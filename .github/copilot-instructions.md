# Copilot instructions

Follow [`AGENTS.md`](../AGENTS.md) at the repository root. It is the single source of
instructions for every AI agent working here: layout, commands, rules and workflow.

Copilot code review may read only this file, so three rules from `AGENTS.md` are
repeated below. This is the one deliberate copy; if it ever disagrees with
`AGENTS.md`, `AGENTS.md` wins.

- **No symlinks anywhere in the repository.** `omarchy plugin add` clones this repo
  *as* the plugin folder, and `omarchy-plugin-validate` refuses any symlink inside
  one. That is why `CLAUDE.md` imports `AGENTS.md` instead of linking to it.
- **The agent's reply is data for the form and nothing else.** AI assist fills form
  fields from a JSON object; the form validates them as if typed, the user confirms,
  and no key, button or IPC call ever runs anything the agent returned.
- **Every permanent-VM write goes through nixarchy.pkg's writers.** `opt set`,
  `opt replace`, `nixarchy-opt-remove` and `nixarchy-service-enable`, never a file
  write. The one-line snippet grammar in `Model.machineSnippet` is the only Nix this
  repository emits, and `Model.parseMachineSnippet` must keep reading it.
