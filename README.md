# pi-manager-core

The shared core of the manager-mode pi extensions.

This extension registers **no tools and no commands**, and it is hidden. It exists
so the other extensions have a single installed directory to resolve shared
behaviour from, and so there is exactly one place where that core's presence is
checked.

## Why a shared core exists

Three extensions — [pi-vibe-blender](../pi-vibe-blender),
[pi-vibe-unity](../pi-vibe-unity) and [pi-unity-blender](../pi-unity-blender) —
each grew the same machinery independently: an engage slash command that turns the
session into a manager, an exit command that lifts a write/edit/image gate, a
child-session detector, a manager-prompt composer, and an installer that stamps
agent templates. Each piece is small. Each was written three times, and the third
copy was written by reading the first two — so every fix to the gate's refusal
message had to be made three times, and nothing noticed when one was missed.

What is shared here is deliberately the part that is genuinely the same. Nothing
in this repository knows about Blender, Unity, geometry, bridge locks, or agents.

**Application policy stays in the application that owns it** — which tools a
manager may use, what to say when it reaches for a write, which file extensions
count as an image. A core that encoded every application's policy would carry all
of them and answer to none. The core exports the mechanism and a `onGateMessage`
callback; the message is the consumer's.

## Install

Install alongside the extensions that use it, the same way they are installed:

```sh
ln -s "$PWD" ~/.pi/agent/extensions/manager-core
```

Or, as a package, from `package.json`'s `pi.extensions` manifest — `index.ts`
sits at the package root rather than under `extensions/`, so that manifest is
load-bearing, not a narrowing.

Each consumer carries a working local copy, so installing one extension without
this one still works. That is deliberate, and it is also the failure mode to watch
for: a silent fallback runs fine and so reports nothing. `npm run which-core`
answers the question a test cannot — *which* core is actually loaded.

```
$ npm run which-core
shared core installed: yes  (~/.pi/agent/extensions/manager-core/shared/core.js)

pi-vibe-blender  shared core
pi-vibe-unity    shared core
pi-unity-blender shared core

OK: every consumer loads the shared core
```

## How the consumers depend on it

Each consumer declares the relationship, so it is recorded rather than implied
by the resolver's probe order:

```json
"peerDependencies": { "pi-manager-core": "*" }
```

A peer, not a dependency, and unbundled — per `docs/packages.md`, an imported Pi
package is a peer with a `*` range. A bundled copy would be a second core in
`node_modules`, which the resolver never looks at, so it would be invisible drift
rather than prevented drift.

The entry is **not enforced by anything**. The consumers load as extensions out
of `<agent-dir>/extensions/`, so pi never reads their `package.json` and npm
never installs for them. That is exactly why the entry has a test:
`test/dependency-declaration.mjs` fails if a consumer stops declaring it, if the
core stops being installable as a package, or if a consumer bundles a second
copy. The declaration is only worth having because something checks it.

## Drift protection

Each consumer keeps a ~30-line `manager-core.ts` that finds this directory and
re-exports it, because a bare `import` of a sibling extension's file cannot be
written without a build step or a package link. Those three copies are
byte-identical by construction and verified as such:

```sh
npm test              # core tests, template checks, and the drift check
npm run check:consumers
npm run fix:consumers # rewrite the copies from the canonical ones here
```

A convention is what already failed three times, so the check is a test.

`manager-core.local.ts` is the canonical fallback copy, itself checked for
behavioural agreement with `shared/core.js` in `test/core.test.mjs` — that suite
runs the same assertions against both, because a copy that drifts from the
original is the exact failure this repository exists to remove.

## Layout

| Path | What it is |
| --- | --- |
| `index.ts` | The extension entry point. No tools, no commands; reports a missing core or consumer once at session start. Deliberately one small file: it exists only to give the core an installed directory, so there is nothing to split. |
| `shared/` | The core itself, as plain ESM JavaScript with a hand-written `.d.ts` per module. Plain JS on purpose: a runtime `import()` of a resolved path must work with no transform step. Split by concern into `paths.js`, `prompts.js`, `session.js`, `manager-mode.js`, `context-injection.js`, `commands.js`. |
| `shared/index.js` | The barrel the six modules are re-exported through. |
| `shared/core.js` | The stable entry point a consumer resolves, re-exporting the barrel. Kept as a separate file because four copies of this path and a resolver that names it are not something to churn for a source-layout decision. |
| `shared/core.d.ts` | The same split for types, and the single declaration path a typed consumer resolves. |
| `manager-core.ts` | The canonical resolver shim, copied byte-for-byte into each consumer. **Do not edit the copies.** |
| `manager-core.local.ts` | The canonical fallback, copied into each consumer as `manager-core.local.ts`. Not split, on purpose: it is the whole point of the file that a consumer with no core installed still works, and a self-contained single file is the only shape that survives that. |
| `shared/agent-template-checks.mjs` | Validation shared by the three installers, so a template cannot ship naming a tool it cannot resolve. |
