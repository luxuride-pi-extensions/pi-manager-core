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

# This job checked the consumers out on purpose, so their absence is an error
# rather than a reason to skip: extension-registration.mjs skips an absent
# checkout by default, and without this the job would pass having verified
# nothing. See REQUIRED in that file.
echo "==> $name: test"
PI_REQUIRE_CONSUMERS=1 npm test

echo "==> $name: OK"