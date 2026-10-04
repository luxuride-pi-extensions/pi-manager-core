#!/usr/bin/env bash
# Run one consumer's OWN test suite, from its checkout, in this repo's CI job.
#
# Why this is a script and not three copies of a GitHub Actions `steps:` block:
# the three consumers are three separate repos with three different dependency
# shapes, and a workflow that spells out all three goes stale the moment one of
# them changes its install command. One file, three callers, one place to edit.
#
# Usage: test/consumers.sh <repo-dir-name>
#
# Assumes the caller has already checked out the sibling repos into the parent
# directory and installed this repo's dependencies. Exits non-zero on the first
# consumer that fails, naming it.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$HERE")"
PROJECTS="$(dirname "$REPO_ROOT")"

name="${1:-}"
if [ -z "$name" ]; then
	echo "usage: $(basename "$0") <repo-dir-name>" >&2
	exit 64
fi

dir="$PROJECTS/$name"
if [ ! -d "$dir" ]; then
	echo "consumers.sh: $name is not checked out at $dir" >&2
	exit 66
fi

cd "$dir"

# `npm ci` refuses to run when a peer dependency is not on the registry, and
# pi-manager-core is exactly that: it is a Pi package loaded from the extensions
# directory, not an npm package. All three consumers declare it with a "*"
# peer range and none of them bundle it, which is the documented shape. So the
# install needs --legacy-peer-deps, or CI fails before a single test runs.
echo "==> $name: npm ci --legacy-peer-deps"
npm ci --legacy-peer-deps

echo "==> $name: typecheck"
npm run --silent typecheck

# pi-manager-core is a PEER dependency, not an npm package, and every
# consumer resolves it at RUNTIME through the resolver shim, which looks in
# pi's installed extensions dir and beside the consumer. Two of the three
# consumers' suites go further than the shim: pi-unity's engagement-test.mjs
# loads $PI_AGENT_DIR/extensions/pi-unity/index.ts and .../unity-blender/
# index.ts by ABSOLUTE path, and pi-unity-blender's manager-prompt.mjs reads
# the sibling pi-blender's manager prompt out of $PI_AGENT_DIR/extensions/.
#
# So the environment alone is not enough. Without the links below, a checkout
# gets 22 failures that all say
#
#   Error: manager-core could not be found. Looked in: ...
#
# plus a MODULE_NOT_FOUND for extensions/pi-unity/index.ts -- and zero real
# signal, because the suite never ran. This is the same set of links pi-unity's
# own CI builds by hand, done once here instead.
#
# The names are the ones pi installs under, which are not the repo names: the
# binder extension is "unity-blender". pi's resolver probes both
# "manager-core" and "pi-manager-core", so either link satisfies the shim.
#
# A missing sibling is reported and skipped rather than failing the run,
# because this script is also run from a working directory that has only the
# core and one consumer -- where pi-blender's own suite runs fine and
# pi-unity-blender's 4 prompt-composition checks are not answerable at all.
# On CI the siblings ARE present and all of this links.
AGENT_DIR="${PI_AGENT_DIR:-$PROJECTS/.pi-agent}"
EXTENSIONS="$AGENT_DIR/extensions"

# mkdir -p because the suite's bridge/liveness checks mkdtemp under the agent
# dir, and mkdtemp will not create a missing parent: without it those fail with
# "ENOENT: no such file or directory, mkdtemp".
mkdir -p "$EXTENSIONS"
link() {
	repo="$1"
	name="$2"
	if [ ! -d "$PROJECTS/$repo" ]; then
		echo "    (skipping $name: $repo is not checked out beside the core)"
		return 0
	fi
	ln -sfn "$PROJECTS/$repo" "$EXTENSIONS/$name"
	echo "    linked $name -> $PROJECTS/$repo"
}
link pi-manager-core manager-core
link pi-manager-core pi-manager-core
link "$name" "$name"
link pi-blender pi-blender
link pi-unity pi-unity
link pi-unity-blender unity-blender

# This job checked the consumers out on purpose, so their absence is an error
# rather than a reason to skip: extension-registration.mjs skips an absent
# checkout by default, and without this the job would pass having verified
# nothing. See REQUIRED in that file.
#
# PI_REQUIRE_CONSUMERS is also how extension-registration.mjs finds them: it
# resolves a consumer as REPO_ROOT/../<name>, which is PROJECTS/<name> -- the
# layout this script already requires and cannot invent if the caller put the
# core somewhere else.
echo "==> $name: test"
PI_MANAGER_CORE_DIR="$REPO_ROOT" \
	PI_AGENT_DIR="$AGENT_DIR" \
	PI_INSTALL_DIR="$AGENT_DIR/install" \
	PI_REQUIRE_CONSUMERS=1 \
	npm test

echo "==> $name: OK"