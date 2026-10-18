# pi-manager-core

The shared core of the manager-mode pi extensions: an engage slash command that
turns the session into a manager, an exit command that lifts a write/edit/image
gate, a child-session detector, a manager-prompt composer, and an installer that
stamps agent templates.

This extension registers **no tools and no commands**, and it is hidden. It
exists so the extensions that use it — [pi-blender](../pi-blender),
[pi-unity-vrchat](../pi-unity-vrchat) and
[pi-unity-blender](../pi-unity-blender) — have a single installed directory to
resolve shared behaviour from, and so there is exactly one place where that
core's presence is checked.

What is shared here is deliberately the part that is genuinely the same.
**Application policy stays in the application that owns it** — which tools a
manager may use, what to say when it reaches for a write, which file extensions
count as an image. A core that encoded every application's policy would carry
all of them and answer to none. The core exports the mechanism and an
`onGateMessage` callback; the message is the consumer's.

## Tools

None. This extension registers no tools and no slash commands; it is library
code loaded by the consumers.

## Install

Install alongside the extensions that use it — they install it for themselves
via a peer dependency. To install it alone:

```bash
pi install npm:@luxuride-pi/manager-core
```

**A missing core is a hard error.** Each consumer used to carry a 420-line
local copy of the whole mechanism, so an extension installed on its own still
ran. That bought a friendly solo install and cost the one thing this repository
exists to protect: the fallback was the only code here that could go stale with
no test shipping beside it, because a consumer installed alone never runs this
suite. So the fallback ran, worked, and reported nothing while being a fork.
`loadManagerCore()` now throws, and the message names every path it tried and
how to fix it — a startup error beats a quietly-forked core.

`npm run which-core` checks what a throwing resolver cannot: that the consumers
resolved the core from the *same* place, rather than one quietly using another
checkout.

```
$ npm run which-core
shared core installed: yes  (~/.pi/agent/extensions/manager-core/shared/core.js)

pi-blender  shared core  <- ~/.pi/agent/extensions/manager-core
pi-unity-vrchat    shared core  <- ~/.pi/agent/extensions/manager-core
pi-unity-blender shared core  <- ~/.pi/agent/extensions/manager-core

OK: every consumer loads the shared core (~/.pi/agent/extensions/manager-core)
```

Each consumer declares the relationship in its `package.json`:

```json
"peerDependencies": { "@luxuride-pi/manager-core": "*" }
```

A peer, not a dependency, and unbundled — a bundled copy would be a second core
in `node_modules`, which the resolver never looks at, so it would be invisible
drift rather than prevented drift. The entry is **not enforced by pi**: the
consumers load as extensions out of `<agent-dir>/extensions/`, so pi never
reads their `package.json`. That is exactly why the entry has a test —
`test/dependency-declaration.mjs` fails if a consumer stops declaring it, if
the core stops being installable as a package, or if a consumer bundles a
second copy.

Each consumer also keeps a `manager-core.ts` shim that finds this directory
and re-exports it (a bare `import` of a sibling extension's file cannot be
written without a build step or a package link). The three copies are
byte-identical and verified as such by `npm run check:consumers`; the shim's
`ManagerCore` contract is checked against the core's real exports in both
directions by `test/core.test.mjs`.

## Layout

| Path | What it is |
| --- | --- |
| `index.ts` | The extension entry point. No tools, no commands; reports a missing core or consumer once at session start. Deliberately one small file: it exists only to give the core an installed directory. |
| `shared/` | The core itself, as plain ESM JavaScript with a hand-written `.d.ts` per module. Plain JS on purpose: a runtime `import()` of a resolved path must work with no transform step. Split by concern into `paths.js`, `prompts.js`, `session.js`, `manager-mode.js`, `context-injection.js`, `commands.js`. |
| `shared/index.js` | The barrel the six modules are re-exported through. |
| `shared/core.js` | The stable entry point a consumer resolves, re-exporting the barrel. Kept as a separate file because the resolver names this exact path. |
| `shared/core.d.ts` | The same split for types, and the single declaration path a typed consumer resolves. |
| `manager-core.ts` | The canonical resolver shim, copied byte-for-byte into each consumer. **Do not edit the copies.** Throws when the core is missing. |
| `shared/agent-template-checks.mjs` | Validation shared by the installers, so a template cannot ship naming a tool it cannot resolve. |

## Releases

Every release is both a **git tag** and an npm package. The package publishes
as `@luxuride-pi/manager-core` from the release workflow via npm trusted
publishing (OIDC from GitHub Actions — no publish token exists anywhere).

pi can also install this extension from a **git ref**: pi clones, checks out
the ref, runs `npm install --legacy-peer-deps`, and loads the extension's
TypeScript straight from source — so a tag *is* the artifact; there is no
build step and nothing to compile.

### Install a release

```bash
pi install npm:@luxuride-pi/manager-core@^<version>
# or, pinned to a git tag:
pi install git:github.com/luxuride-pi-extensions/pi-manager-core@v<version>
```

### Cut a release

1. Bump `version` in `package.json` and commit that on its own.
2. Tag the commit that contains the bump — the tag and the version must agree:
   ```bash
   git tag v<version> && git push origin master --tags
   ```
3. `.github/workflows/release.yml` packs the tarball, checks it, and publishes
   the release with generated notes.

The workflow refuses to guess: it fails when the tag is not on the commit being
released, and again when the tag does not match `package.json`'s `version`.
Bump the version *before* tagging; the tag is not the place to bump.

## License

MIT
