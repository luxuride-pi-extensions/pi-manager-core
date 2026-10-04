# pi-manager-core

The shared core of the manager-mode pi extensions.

This extension registers **no tools and no commands**, and it is hidden. It exists
so the other extensions have a single installed directory to resolve shared
behaviour from, and so there is exactly one place where that core's presence is
checked.

## Why a shared core exists

Three extensions — [pi-blender](../pi-blender),
[pi-unity](../pi-unity) and [pi-unity-blender](../pi-unity-blender) —
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

**A missing core is a hard error.** Each consumer used to carry a 420-line local
copy of the whole mechanism, so an extension installed on its own still ran. That
bought a friendly solo install and cost the one thing this repository exists to
protect: the fallback was the only code here that could go stale with no test
shipping beside it, because a consumer installed alone never runs this suite. So
the fallback ran, worked, and reported nothing while being a fork. `loadManagerCore()`
now throws, and the message names every path it tried and how to fix it — a
startup error beats a quietly-forked core.

`npm run which-core` checks what a throwing resolver cannot: that the consumers
resolved the core from the *same* place, rather than one quietly using another
checkout.

```
$ npm run which-core
shared core installed: yes  (~/.pi/agent/extensions/manager-core/shared/core.js)

pi-blender  shared core  <- ~/.pi/agent/extensions/manager-core
pi-unity    shared core  <- ~/.pi/agent/extensions/manager-core
pi-unity-blender shared core  <- ~/.pi/agent/extensions/manager-core

OK: every consumer loads the shared core (~/.pi/agent/extensions/manager-core)
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

Each consumer keeps a `manager-core.ts` that finds this directory and re-exports
it, because a bare `import` of a sibling extension's file cannot be written
without a build step or a package link. Those three copies are byte-identical by
construction and verified as such:

```sh
npm test              # core tests, template checks, and the drift check
npm run check:consumers
npm run fix:consumers # rewrite the copies from the canonical ones here
```

A convention is what already failed three times, so the check is a test.

There is no fallback to check any more, which is why there are two files per
consumer rather than three. What replaced the type-safety the fallback used to
provide: the shim's `ManagerCore` contract is now written out by hand, and
`test/core.test.mjs` compares it against the core's real exports **in both
directions**. A name the contract declares that the core lacks is a crash in a
consumer weeks later; a name the core has that the contract omits is a core fix
that silently never reaches the extensions. Both are quiet, so both are tested.

## Layout

| Path | What it is |
| --- | --- |
| `index.ts` | The extension entry point. No tools, no commands; reports a missing core or consumer once at session start. Deliberately one small file: it exists only to give the core an installed directory, so there is nothing to split. |
| `shared/` | The core itself, as plain ESM JavaScript with a hand-written `.d.ts` per module. Plain JS on purpose: a runtime `import()` of a resolved path must work with no transform step. Split by concern into `paths.js`, `prompts.js`, `session.js`, `manager-mode.js`, `context-injection.js`, `commands.js`. |
| `shared/index.js` | The barrel the six modules are re-exported through. |
| `shared/core.js` | The stable entry point a consumer resolves, re-exporting the barrel. Kept as a separate file because the resolver names this exact path and churning it for a source-layout decision would be churn with no payoff. |
| `shared/core.d.ts` | The same split for types, and the single declaration path a typed consumer resolves. |
| `manager-core.ts` | The canonical resolver shim, copied byte-for-byte into each consumer. **Do not edit the copies.** Throws when the core is missing; declares the `ManagerCore` contract by hand, checked against the real exports in both directions. |
| `shared/agent-template-checks.mjs` | Validation shared by the three installers, so a template cannot ship naming a tool it cannot resolve. |

## Releases

Every release is a **git tag**, not a published npm package. All four packages
in this organization are `"private": true`, so `npm publish` refuses them, and
unsetting that flag to get a publish through would trade a correct manifest for
a working script.

pi installs this extension from the **clone**, not from a tarball: `installGit()`
runs `git clone`, an optional `git checkout <ref>`, then
`npm install --legacy-peer-deps` inside it, and pi loads the extension's
TypeScript straight from source through jiti. So a tag *is* the artifact — there
is no build step and nothing to compile.

### Install a release

```bash
pi install git:github.com/luxuride-pi-extensions/pi-manager-core@v<version>
```

The `@ref` is what pins the version; without it pi tracks the default branch, so
an unpinned spec is not a release, it is a moving target.

### Cut a release

1. Bump `version` in `package.json` and commit that on its own.
2. Tag the commit that contains the bump — the tag and the version must agree:
   ```bash
   git tag v<version> && git push origin master --tags
   ```
3. `.github/workflows/release.yml` packs the tarball, checks it, and publishes
   the release with generated notes.

Step 2 is the one that is easy to get wrong, so the workflow refuses to guess:
it fails when the tag is not on the commit being released, and again when the
tag does not match `package.json`'s `version`. Bump the version *before*
tagging; the tag is not the place to bump.

The `npm pack --dry-run` check in the release workflow is deliberately a copy of
what `pi-manager-core`'s `test/package-contents.mjs` proves on every CI run. A
release workflow that borrowed the check from another repository would depend on
that repository being checked out at the right ref, which is a moving part a
release should not have.
