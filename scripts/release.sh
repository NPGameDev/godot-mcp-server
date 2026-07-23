#!/usr/bin/env bash
#
# release.sh — cut a release of the server (this repo).
#
# Validates the version, runs the pre-flights, bumps package.json (and the
# lockfile via npm version), rolls the CHANGELOG, pauses for you to curate, then
# commits and creates an ANNOTATED tag. It does NOT push. See RELEASING.md for
# the full release process.
#
# The server and the toolkit version INDEPENDENTLY (each its own tags + cadence),
# so this script releases only the server — releasing the server alone is
# correct, not an edge case. For a change that genuinely spans both repos, pass
# --with-sibling <toolkit-version>: it delegates the toolkit half to the
# toolkit's own release.sh and then releases the server, printing two
# INDEPENDENT versioned release summaries.
#
# Runs under Git Bash / POSIX sh on Windows: quote every path (working trees live
# under OneDrive paths with spaces) and CR-strip any capture from a Windows shim
# (npm is npm.cmd; its stdout can carry a trailing \r).
set -euo pipefail

# ── Location ────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

PACKAGE_JSON="package.json"
PACKAGE_LOCK="package-lock.json"
CHANGELOG="CHANGELOG.md"
CROSS_VERSION_YML=".github/workflows/cross-version.yml"
PKG_NAME="@npgamedev/godot-mcp-server"

# ── Usage / argument parsing ────────────────────────────────────────────────
usage() {
  cat <<'EOF'
Usage: ./scripts/release.sh <server-version> [--dry-run] [--with-sibling <toolkit-version>]
       ./scripts/release.sh --verify <server-version>    # read-only post-push convergence check

Examples:
  ./scripts/release.sh 1.1.0                        # release the server
  ./scripts/release.sh 1.1.0 --dry-run              # validate + report; write nothing
  ./scripts/release.sh 1.1.0 --with-sibling 1.2.0   # spanning change: two independent versions
  ./scripts/release.sh --verify 1.1.0               # after pushing: assert convergence
EOF
}

VERSION=""
DRY_RUN=0
VERIFY=0
SIBLING_VERSION=""
# Parse: --verify takes the version as its own value and branches to a read-only
# path; the first bare positional is the server version otherwise. --with-sibling
# consumes the next argument as the toolkit version.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --verify)
      VERIFY=1
      shift
      [[ $# -gt 0 ]] || { echo "error: --verify requires a version." >&2; usage; exit 1; }
      VERSION="$1"
      ;;
    --with-sibling)
      shift
      [[ $# -gt 0 ]] || { echo "error: --with-sibling requires a toolkit version." >&2; usage; exit 1; }
      SIBLING_VERSION="$1"
      ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "error: unknown flag '$1'." >&2; usage; exit 1 ;;
    *)
      if [[ -n "${VERSION}" ]]; then
        echo "error: unexpected extra argument '$1'." >&2; usage; exit 1
      fi
      VERSION="$1"
      ;;
  esac
  shift
done

if [[ -z "${VERSION}" ]]; then
  echo "error: a target version is required." >&2
  usage
  exit 1
fi

TAG="v${VERSION}"

fail() { echo "::error::$*" >&2; echo "error: $*" >&2; exit 1; }

# Resolve the toolkit sibling repo path (env override, else the on-disk sibling).
# Quoted at every use — the working trees live under OneDrive paths with spaces.
TOOLKIT_REPO="${GODOT_MCP_TOOLKIT_REPO:-../godot-mcp-toolkit}"

# ── Version-format validation ───────────────────────────────────────────────
validate_semver() {
  local v="$1" what="$2"
  if ! [[ "${v}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    fail "${what} '${v}' is not a well-formed semver (expected X.Y.Z)."
  fi
}
validate_semver "${VERSION}" "version"
[[ -n "${SIBLING_VERSION}" ]] && validate_semver "${SIBLING_VERSION}" "toolkit version"

# Is PKG_NAME@VERSION already on npm? Distinguishes a genuine 404 (version absent →
# available) from a registry/auth/transport error (which must NOT be read as
# "available" — a hard-stop keyed off that would then be bypassed by a flaky
# network). Echoes one of: "published" | "absent" | "unreachable". Uses --json and
# inspects the error code: E404 on <pkg>@<ver> with the PACKAGE itself resolving
# (or E404 naming the exact version) = absent; any other error, or an E404 whose
# root is a package that also fails for a NON-404 reason = unreachable. A brand-new
# package (never published — the first-release case) legitimately 404s and is
# treated as absent.
npm_version_state() {
  local out code
  out="$(npm view "${PKG_NAME}@${VERSION}" version --json 2>&1 | tr -d '\r')"
  code=$?
  if [[ ${code} -eq 0 && -n "${out}" && "${out}" != "null" && "${out}" != *'"error"'* ]]; then
    echo "published"; return 0
  fi
  # Non-zero / empty: a 404 (version or package absent) means AVAILABLE; anything
  # else (ENOTFOUND, ETIMEDOUT, E401/403, 5xx) means the registry can't be trusted.
  if echo "${out}" | grep -qiE 'E404|404 Not Found|code.*E404'; then
    echo "absent"; return 0
  fi
  echo "unreachable"; return 0
}

# ══════════════════════════════════════════════════════════════════════════════
# --verify — read-only post-push convergence check (mutates NOTHING)
# ══════════════════════════════════════════════════════════════════════════════
if [[ ${VERIFY} -eq 1 ]]; then
  echo "── Convergence check for ${TAG} (read-only) ──────────────────────────"

  # Server origin tag.
  if [[ -n "$(git ls-remote --tags origin "refs/tags/${TAG}" 2>/dev/null)" ]]; then
    server_tag="PASS"
  else
    server_tag="MISSING"
  fi

  # Toolkit origin tag (resolve the sibling path as in the pin pre-flight).
  if [[ -d "${TOOLKIT_REPO}/.git" ]]; then
    if [[ -n "$(git -C "${TOOLKIT_REPO}" ls-remote --tags origin "refs/tags/${TAG}" 2>/dev/null)" ]]; then
      toolkit_tag="PASS"
    else
      toolkit_tag="MISSING"
    fi
  else
    toolkit_tag="UNKNOWN (toolkit repo not found at '${TOOLKIT_REPO}')"
  fi

  # npm registry — read-only poll: a 404 (not yet propagated) or a registry hiccup
  # both mean "poll again" (PENDING); only a resolved version is PASS.
  if [[ "$(npm_version_state)" == "published" ]]; then
    npm_pub="PASS"
  else
    npm_pub="PENDING"
  fi

  echo "  Server origin tag ${TAG}:   ${server_tag}"
  echo "  Toolkit origin tag ${TAG}:  ${toolkit_tag}"
  echo "  npm ${PKG_NAME}@${VERSION}: ${npm_pub}"
  echo "──────────────────────────────────────────────────────────────────────"

  # MISSING = a tag is absent on an origin (partial push). PENDING = tag present
  # but npm not yet resolving (registry propagation lag — poll again). PASS = tag
  # on both origins + npm resolves.
  if [[ "${server_tag}" == "PASS" && "${toolkit_tag}" == "PASS" && "${npm_pub}" == "PASS" ]]; then
    echo "✓ Converged: tag on both origins and the package resolves on npm."
  elif [[ "${server_tag}" == "MISSING" || "${toolkit_tag}" == "MISSING" ]]; then
    echo "⚠ A tag is MISSING on an origin — a partial push. Push the missing side."
  else
    echo "… npm PENDING — the registry can lag a publish by seconds to minutes; poll again."
  fi
  exit 0
fi

# ── Failure-path undo print ─────────────────────────────────────────────────
# Capture the pre-run HEAD(s); on an abort AFTER a commit or tag was created,
# print the exact per-repo undo commands. Print-only — this script never rewinds
# anything (two-repo atomicity automation stays post-1.0).
PRE_RUN_SHA="$(git rev-parse HEAD)"
TOOLKIT_PRE_RUN_SHA=""
if [[ -n "${SIBLING_VERSION}" && -d "${TOOLKIT_REPO}/.git" ]]; then
  TOOLKIT_PRE_RUN_SHA="$(git -C "${TOOLKIT_REPO}" rev-parse HEAD 2>/dev/null || true)"
fi
COMMIT_MADE=0
TAG_MADE=0

on_exit() {
  local code=$?
  [[ ${code} -eq 0 ]] && return

  # Did the toolkit half (delegated under --with-sibling) already mutate? Detect
  # it independently of the server's own COMMIT_MADE/TAG_MADE flags — the toolkit
  # is delegated before the server's mutation, so a server-side abort would leave
  # those flags 0 while the toolkit is already committed+tagged (the exact
  # half-done-spanning-release gap). Guard: pre-run SHA captured AND the toolkit
  # tag now exists OR its HEAD advanced.
  local toolkit_mutated=0
  if [[ -n "${TOOLKIT_PRE_RUN_SHA}" ]]; then
    local tk_now
    tk_now="$(git -C "${TOOLKIT_REPO}" rev-parse HEAD 2>/dev/null || true)"
    if [[ -n "$(git -C "${TOOLKIT_REPO}" tag -l "${TAG}" 2>/dev/null)" ]] || \
       [[ -n "${tk_now}" && "${tk_now}" != "${TOOLKIT_PRE_RUN_SHA}" ]]; then
      toolkit_mutated=1
    fi
  fi

  if [[ ${COMMIT_MADE} -eq 1 || ${TAG_MADE} -eq 1 || ${toolkit_mutated} -eq 1 ]]; then
    echo ""
    echo "── Aborted after a mutation. Undo with: ──────────────────────────────"
    if [[ ${COMMIT_MADE} -eq 1 || ${TAG_MADE} -eq 1 ]]; then
      if [[ ${TAG_MADE} -eq 1 ]]; then
        echo "  git -C \"${REPO_ROOT}\" tag -d ${TAG}"
      fi
      echo "  git -C \"${REPO_ROOT}\" reset --hard ${PRE_RUN_SHA}"
    fi
    if [[ ${toolkit_mutated} -eq 1 ]]; then
      echo "  # The toolkit half already committed/tagged (--with-sibling):"
      echo "  git -C \"${TOOLKIT_REPO}\" tag -d ${TAG}"
      echo "  git -C \"${TOOLKIT_REPO}\" reset --hard ${TOOLKIT_PRE_RUN_SHA}"
    fi
    echo "──────────────────────────────────────────────────────────────────────"
  fi
}
trap on_exit EXIT

# --with-sibling delegates to the toolkit's OWN release.sh (never reimplement its
# plugin.cfg / CHANGELOG / tag logic here). Locate + validate the script now, but
# do NOT invoke it yet: the toolkit mutation must run AFTER the server's read-only
# pre-flights (so a server pre-flight failure can't leave a half-done spanning
# release the undo trap wouldn't catch). It fires in the mutation path below, or —
# under --dry-run — inside the dry-run short-circuit (non-mutating either way).
if [[ -n "${SIBLING_VERSION}" ]]; then
  TOOLKIT_RELEASE_SH="${TOOLKIT_REPO}/scripts/release.sh"
  [[ -f "${TOOLKIT_RELEASE_SH}" ]] || \
    fail "toolkit release script not found at '${TOOLKIT_RELEASE_SH}' (set GODOT_MCP_TOOLKIT_REPO)."
fi

# Delegate the toolkit half to its OWN release.sh. --dry-run propagates so a
# rehearsal writes nothing in either repo. Called once — either from the dry-run
# short-circuit or from the mutation path (after the server's read-only pre-flights).
delegate_toolkit_release() {
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  --with-sibling: releasing the toolkit half (v${SIBLING_VERSION})"
  echo "══════════════════════════════════════════════════════════════════════"
  if [[ ${DRY_RUN} -eq 1 ]]; then
    bash "${TOOLKIT_RELEASE_SH}" "${SIBLING_VERSION}" --dry-run
  else
    bash "${TOOLKIT_RELEASE_SH}" "${SIBLING_VERSION}"
  fi
  echo ""
  echo "  ↑ Toolkit block above is an INDEPENDENT version (its own tag + Asset"
  echo "    submission values). Now releasing the server (v${VERSION}) below."
  echo "══════════════════════════════════════════════════════════════════════"
  echo ""
}

# ── Current version from package.json (the server's version surface) ─────────
CURRENT_VERSION="$(npm pkg get version | tr -d '"\r')"
[[ -n "${CURRENT_VERSION}" ]] || fail "could not read version from ${PACKAGE_JSON}."

# ── Monotonicity vs the highest existing v* tag ─────────────────────────────
# The highest v* tag is the monotonicity authority; the manifest is a cross-check
# only (it says 1.0.0 today, and the first real invocation is release.sh 1.0.0
# with no tag yet — the equal-iff-untagged path). EQUAL is the untagged
# recovery/first-release path only; server-side it additionally requires the
# registry to NOT already carry the version (the registry is the unredoable step).
EQUAL_PATH=0
LATEST_TAG="$(git tag -l 'v*' | sort -V | tail -1 || true)"
if [[ -n "${LATEST_TAG}" ]]; then
  LATEST_VER="${LATEST_TAG#v}"
  if [[ "${VERSION}" == "${LATEST_VER}" ]]; then
    EQUAL_PATH=1
    # Server tightening: on the equal path the registry MUST NOT already carry
    # the version (a tag is deletable pre-publish; a publish never is).
    case "$(npm_version_state)" in
      published)   fail "version ${VERSION} equals the highest tag ${LATEST_TAG} AND is already on npm — nothing to recover." ;;
      unreachable) fail "cannot reach the npm registry to verify ${PKG_NAME}@${VERSION} — refusing to proceed on an unverifiable availability check." ;;
    esac
  else
    HIGHEST="$(printf '%s\n%s\n' "${VERSION}" "${LATEST_VER}" | sort -V | tail -1)"
    if [[ "${HIGHEST}" != "${VERSION}" ]]; then
      fail "version ${VERSION} is not greater than the highest tag ${LATEST_TAG}."
    fi
  fi
else
  # No v* tag yet — any valid target at or above the manifest is fine on this
  # first-release / untagged path. Equal to the manifest is the equal (recovery)
  # path, so npm version needs --allow-same-version below.
  HIGHEST="$(printf '%s\n%s\n' "${VERSION}" "${CURRENT_VERSION}" | sort -V | tail -1)"
  if [[ "${HIGHEST}" != "${VERSION}" ]]; then
    fail "version ${VERSION} is below the current ${PACKAGE_JSON} version ${CURRENT_VERSION}."
  fi
  [[ "${VERSION}" == "${CURRENT_VERSION}" ]] && EQUAL_PATH=1
fi

# ── Fetch-first, then on-main / clean / up-to-date ──────────────────────────
echo "→ Fetching origin/main…"
git fetch origin main

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "${CURRENT_BRANCH}" == "main" ]] || fail "not on main (on '${CURRENT_BRANCH}')."

if [[ -n "$(git status --porcelain)" ]]; then
  fail "working tree is not clean. Commit or stash first."
fi

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"
[[ "${LOCAL_HEAD}" == "${REMOTE_HEAD}" ]] || \
  fail "HEAD (${LOCAL_HEAD}) is not up to date with origin/main (${REMOTE_HEAD})."

# ── Pre-flight — target-version available (one check across all three surfaces) ─
if [[ -n "$(git tag -l "${TAG}")" ]]; then
  fail "tag ${TAG} already exists locally — a genuine collision."
fi
if [[ -n "$(git ls-remote --tags origin "refs/tags/${TAG}")" ]]; then
  fail "tag ${TAG} already exists on origin — a genuine collision."
fi
# Server: the registry is the unredoable surface — if it resolves, the version
# already shipped, so hard-stop before any mutation. A registry error is NOT read
# as "available" (that would let a flaky network bypass this hard-stop).
case "$(npm_version_state)" in
  published)   fail "${PKG_NAME}@${VERSION} is already published on npm — a genuine collision." ;;
  unreachable) fail "cannot reach the npm registry to verify ${PKG_NAME}@${VERSION} — refusing to proceed on an unverifiable availability check." ;;
esac

# ── Pre-flight — code-identical sibling pin ─────────────────────────────────
# The tag-fired behavioral gate checks the toolkit out at SIBLING_PIN_TOOLKIT.
# That pin must be code-identical to the toolkit's main (a stale pin certifies a
# drifted sibling — green tests of the WRONG pairing). Allow only a metadata-only
# offset (the pin/version-bump commits touch the pin file) — any other changed
# path aborts.
SIBLING_PIN_TOOLKIT="$(grep 'SIBLING_PIN_TOOLKIT:' "${CROSS_VERSION_YML}" | sed -E 's/.*"([0-9a-f]+)".*/\1/')"
[[ -n "${SIBLING_PIN_TOOLKIT}" ]] || fail "could not read SIBLING_PIN_TOOLKIT from ${CROSS_VERSION_YML}."

if [[ ! -d "${TOOLKIT_REPO}/.git" ]]; then
  fail "toolkit sibling repo not found at '${TOOLKIT_REPO}' (set GODOT_MCP_TOOLKIT_REPO)."
fi

echo "→ Fetching the toolkit sibling's origin/main…"
git -C "${TOOLKIT_REPO}" fetch origin main

# Allowlist: metadata paths whose drift from the pin is expected (the pin-bump +
# version-bump commits touch them). Everything else must be code-identical.
CHANGED_PATHS="$(git -C "${TOOLKIT_REPO}" diff --name-only "${SIBLING_PIN_TOOLKIT}..origin/main" || true)"
OFFENDING=""
while IFS= read -r path; do
  [[ -z "${path}" ]] && continue
  case "${path}" in
    .github/workflows/cross-version.yml) ;;   # sibling-pin bump lives here
    *) OFFENDING="${OFFENDING}${path}"$'\n' ;;
  esac
done <<< "${CHANGED_PATHS}"

if [[ -n "${OFFENDING}" ]]; then
  echo "::error::The pinned toolkit (${SIBLING_PIN_TOOLKIT}) is not code-identical to toolkit main." >&2
  echo "Offending paths:" >&2
  echo "${OFFENDING}" >&2
  fail "Run the bump-before-tag ritual first — bump SIBLING_PIN_TOOLKIT to the certified toolkit revision in a [run-cross-version-ci] commit, let CI go green, then re-run."
fi

# ── Pre-flight — CI green on both HEADs ─────────────────────────────────────
check_ci_green() {
  local repo_slug="$1" sha="$2"
  local json conclusion
  json="$(gh api "repos/${repo_slug}/commits/${sha}/check-runs" 2>/dev/null || echo '')"
  [[ -z "${json}" ]] && return 2
  # Any non-success (or a still-running) conclusion => not green.
  conclusion="$(echo "${json}" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try{
        const runs=(JSON.parse(s).check_runs)||[];
        if(runs.length===0){process.stdout.write("empty");return;}
        for(const r of runs){
          if(r.status!=="completed"){process.stdout.write("pending");return;}
          if(r.conclusion!=="success"&&r.conclusion!=="neutral"&&r.conclusion!=="skipped"){process.stdout.write("red");return;}
        }
        process.stdout.write("green");
      }catch(e){process.stdout.write("error");}
    });
  ')"
  [[ "${conclusion}" == "green" ]] && return 0
  return 1
}

TOOLKIT_HEAD="$(git -C "${TOOLKIT_REPO}" rev-parse origin/main)"
if command -v gh >/dev/null 2>&1; then
  echo "→ Checking CI on both HEADs…"
  gh_ok=1
  check_ci_green "NPGameDev/godot-mcp-server" "${LOCAL_HEAD}" || gh_ok=0
  check_ci_green "NPGameDev/godot-mcp-toolkit" "${TOOLKIT_HEAD}" || gh_ok=0
  if [[ ${gh_ok} -ne 1 ]]; then
    fail "CI is not green (or is pending) on both HEADs. Wait for green, then re-run."
  fi
  echo "  CI green on both HEADs."
else
  echo "⚠ gh CLI not available — cannot verify CI is green on both HEADs."
  read -r -p "Confirm CI is green on server ${LOCAL_HEAD} and toolkit ${TOOLKIT_HEAD}? [y/N] " reply
  [[ "${reply}" == "y" || "${reply}" == "Y" ]] || fail "CI-green confirmation declined."
fi

# ── Pre-flight — generated-docs freshness note (regen happens in the mutation path) ─
# A dry-run must not touch the working tree, so the actual regeneration is deferred
# to the mutation path below (after the --dry-run short-circuit). Here we only note
# the intent so the dry-run report is honest.
echo "→ Generated docs (docs:api + docs:tools) will be regenerated and staged during the release."

# ── Pre-flight — manual-gate reminder ───────────────────────────────────────
cat <<'EOF'

── Manual pre-release gate ───────────────────────────────────────────────────
Before tagging, the interactive checks CI cannot reach must be green:
  • export-strip
  • connection stability
  • security
  • human + MCP concurrent editing
See docs/dev/release-checklist.md and work through it.
──────────────────────────────────────────────────────────────────────────────
EOF
read -r -p "Has the manual pre-release gate passed? [y/N] " reply
[[ "${reply}" == "y" || "${reply}" == "Y" ]] || fail "manual pre-release gate not confirmed."

# ── --dry-run short-circuit ─────────────────────────────────────────────────
if [[ ${DRY_RUN} -eq 1 ]]; then
  # Both halves are non-mutating under --dry-run, so ordering is safe here — fire
  # the toolkit delegation to prove the wiring, then report the server dry-run.
  [[ -n "${SIBLING_VERSION}" ]] && delegate_toolkit_release
  cat <<EOF

── DRY RUN — no writes, no commit, no tag ────────────────────────────────────
Would bump ${PACKAGE_JSON} (+ ${PACKAGE_LOCK}): ${CURRENT_VERSION} → ${VERSION}
Would roll ${CHANGELOG}: '## [Unreleased]' → '## [${VERSION}] - $(date +%F)'
Would commit (chore(release): ${TAG}) staging only ${PACKAGE_JSON} + ${PACKAGE_LOCK} + ${CHANGELOG} + any regenerated docs/
Would create ANNOTATED tag ${TAG} carrying the rolled CHANGELOG section
Push (does NOT push): git push origin main ${TAG}
──────────────────────────────────────────────────────────────────────────────
EOF
  echo "Dry run complete — nothing was written."
  exit 0
fi

# ══════════════════════════════════════════════════════════════════════════════
# Mutation path — [sibling] → regen docs → bump → roll → PAUSE → commit → tag
# ══════════════════════════════════════════════════════════════════════════════

# ── 0a. Delegate the toolkit half (only now — all server read-only pre-flights
#        above have passed, so a server pre-flight can no longer leave a half-done
#        spanning release). If the toolkit half commits+tags, the failure trap's
#        TOOLKIT_PRE_RUN_SHA branch prints its undo commands on any later abort.
if [[ -n "${SIBLING_VERSION}" ]]; then
  delegate_toolkit_release
fi

# ── 0b. Regenerate BOTH generated-doc surfaces (staged at commit time) ──────
#    A release that renames/adds a tool must not ship a stale tool-reference (the
#    human-facing "what can it do" doc the README funnels to). Do NOT abort on
#    drift — the regenerated files are staged at commit time (§4) so the tag run
#    cannot die at release.yml's freshness gate. Deferred here from the pre-flight
#    so a --dry-run never touches the tree.
echo "→ Regenerating generated docs (API + tool reference)…"
npm run docs:api
npm run docs:tools
DOCS_DRIFT="$(git status --porcelain docs/ || true)"
if [[ -n "${DOCS_DRIFT}" ]]; then
  echo "  Generated docs drifted — the regenerated files will be included in the release commit:"
  echo "${DOCS_DRIFT}"
else
  echo "  Generated docs already fresh."
fi

# ── 1. Bump the manifest via npm version (keeps package-lock.json in sync) ───
#    A hand-edit would desync the lockfile → the release workflow's npm ci fails
#    on the tag run. On the equal (recovery) path, --allow-same-version is
#    required (plain npm version errors on same-version).
if [[ ${EQUAL_PATH} -eq 1 ]]; then
  npm version "${VERSION}" --allow-same-version --no-git-tag-version >/dev/null
else
  npm version "${VERSION}" --no-git-tag-version >/dev/null
fi

NEW_VERSION="$(npm pkg get version | tr -d '"\r')"
[[ "${NEW_VERSION}" == "${VERSION}" ]] || fail "${PACKAGE_JSON} bump failed (got '${NEW_VERSION}')."
echo "✓ ${PACKAGE_JSON} + ${PACKAGE_LOCK} bumped to ${VERSION}"

# ── 2. Roll the CHANGELOG ────────────────────────────────────────────────────
#    Keep-a-Changelog bracketed heading: '## [Unreleased]' → '## [X.Y.Z] - date',
#    with a fresh empty '## [Unreleased]' above. No KaC link-refs to maintain.
if ! grep -qF "## [Unreleased]" "${CHANGELOG}"; then
  fail "no '## [Unreleased]' heading in ${CHANGELOG} — cannot roll."
fi

RELEASE_DATE="$(date +%F)"
SECTION_FILE="${TMPDIR:-C:/Users/nicol/OneDrive/Desktop/Personal/AIWithGodot/_TempForClaude}/release-changelog-${VERSION}.$$.md"
mkdir -p "$(dirname "${SECTION_FILE}")"

TMP_CL="${CHANGELOG}.tmp.$$"
awk -v ver="${VERSION}" -v date="${RELEASE_DATE}" '
  {
    if ($0 == "## [Unreleased]") {
      print "## [Unreleased]";
      print "";
      print "## [" ver "] - " date;
    } else {
      print $0;
    }
  }
' "${CHANGELOG}" > "${TMP_CL}"
mv "${TMP_CL}" "${CHANGELOG}"
echo "✓ ${CHANGELOG} rolled: [Unreleased] → [${VERSION}] - ${RELEASE_DATE}"

# Warn (do not abort) if the rolled section is empty. On the expected-empty
# coordinated case (--with-sibling, this repo unchanged), offer the alignment
# line so the section is not blank at release time.
# Match the header by literal prefix (index), not a dynamic regex: a bracketed
# version like [1.0.0] in a regex becomes a character class, so the real header
# never matches. Boundary = the next H2 that is NOT this version's header (stops
# at a non-bracketed tail like '## Prior history' too).
ROLLED_BODY="$(awk -v ver="${VERSION}" '
  index($0, "## [" ver "]") == 1 { grab=1; next }
  grab && index($0, "## ") == 1 { exit }
  grab { print }
' "${CHANGELOG}" | grep -v '^[[:space:]]*$' || true)"
if [[ -z "${ROLLED_BODY}" ]]; then
  echo "⚠ The rolled [${VERSION}] section is empty — curate it during the pause below."
  echo "  (Draft source only, NEVER piped over ${CHANGELOG}:"
  echo "   scripts/generate-changelog.sh --since=${LATEST_TAG:-v${CURRENT_VERSION}})"
  if [[ -n "${SIBLING_VERSION}" ]]; then
    read -r -p "Insert 'No functional changes; version aligned with toolkit v${SIBLING_VERSION}.' into the section? [y/N] " reply
    if [[ "${reply}" == "y" || "${reply}" == "Y" ]]; then
      TMP_CL="${CHANGELOG}.tmp.$$"
      awk -v ver="${VERSION}" -v sib="${SIBLING_VERSION}" '
        {
          print $0;
          if (index($0, "## [" ver "]") == 1) {
            print "";
            print "No functional changes; version aligned with toolkit v" sib ".";
          }
        }
      ' "${CHANGELOG}" > "${TMP_CL}"
      mv "${TMP_CL}" "${CHANGELOG}"
      echo "✓ Alignment line inserted into the [${VERSION}] section."
    fi
  fi
fi

# ── 3. PAUSE for curation ────────────────────────────────────────────────────
#    Print the npm pack file listing during the pause — catches a files:-field
#    mistake while a human is already looking at the release.
echo ""
echo "── npm pack --dry-run (the exact tarball that would ship) ─────────────"
npm pack --dry-run 2>&1 || true
echo "──────────────────────────────────────────────────────────────────────"
echo ""
read -r -p "Review/curate the rolled CHANGELOG section now. Continue? [y/N] " reply
[[ "${reply}" == "y" || "${reply}" == "Y" ]] || fail "release paused — curation not confirmed."

# On resume, re-verify only the expected files changed (the pause breaks the
# clean-tree assumption). Expected: package.json, package-lock.json, CHANGELOG,
# and any regenerated docs/ files.
UNEXPECTED="$(git status --porcelain | grep -vE " (${PACKAGE_JSON}|${PACKAGE_LOCK}|${CHANGELOG})$" | grep -vE " docs/" || true)"
if [[ -n "${UNEXPECTED}" ]]; then
  echo "::error::Unexpected changes in the working tree after the pause:" >&2
  echo "${UNEXPECTED}" >&2
  fail "only ${PACKAGE_JSON}, ${PACKAGE_LOCK}, ${CHANGELOG}, and regenerated docs/ may change during a release."
fi

# ── 4. Commit (stage ONLY the expected paths by explicit path) ──────────────
git add "${PACKAGE_JSON}" "${PACKAGE_LOCK}" "${CHANGELOG}"
# Narrow docs/ to the actually-changed files (never a blanket add).
CHANGED_DOCS="$(git status --porcelain docs/ | awk '{print $2}' || true)"
if [[ -n "${CHANGED_DOCS}" ]]; then
  # shellcheck disable=SC2086
  git add ${CHANGED_DOCS}
fi
git commit -m "chore(release): ${TAG}"
COMMIT_MADE=1
TAGGED_COMMIT="$(git rev-parse HEAD)"
echo "✓ Commit created: ${TAGGED_COMMIT}"

# ── 5. Annotated tag (carrying the rolled section) — never amend after ──────
#    Lightweight tags carry no message and are invisible to tooling that derives
#    a GH Release body from the tag; annotated carries the CHANGELOG section.
# Literal-prefix match (index), not a dynamic regex — a bracketed version is a
# character class in regex, so the header never matches and the section extracts
# empty. Boundary = the next H2 that is not this version's header, which also
# stops at a non-bracketed tail like '## Prior history'.
awk -v ver="${VERSION}" '
  index($0, "## [" ver "]") == 1 { grab=1 }
  grab && index($0, "## ") == 1 && index($0, "## [" ver "]") != 1 { exit }
  grab { print }
' "${CHANGELOG}" > "${SECTION_FILE}"
if [[ ! -s "${SECTION_FILE}" ]]; then
  fail "extracted CHANGELOG section for ${TAG} is empty — refusing to create a message-less annotated tag."
fi
# --cleanup=verbatim: the default (strip) DELETES every '#'-leading line, which
# would silently drop the '## [X.Y.Z]' header and all '### ' subheads from the tag
# message (the GH Release body derives from it) — the body would survive, so a
# non-empty check alone wouldn't catch the loss. verbatim keeps the section intact.
git tag -a "${TAG}" --cleanup=verbatim -F "${SECTION_FILE}"
TAG_MADE=1
echo "✓ Annotated tag ${TAG} created"
rm -f "${SECTION_FILE}"

# ── Summary + push instructions (does NOT push) ─────────────────────────────
cat <<EOF

✓ server bumped to ${TAG} (CHANGELOG curated and committed)
✓ Commit created, annotated tag applied  (toolkit untouched — independent versioning)

Next steps:
  1. Push server: cd "${REPO_ROOT}" && git push origin main ${TAG}
  2. The tag fires the GATED release workflow — the full behavioral matrix runs
     first; publish / GH Release only fire if it is green. A red leg blocks the
     release (by design). Transient failure? Re-dispatch release.yml ON the tag
     ref with dry-run: false — do not delete/re-push the tag.
  3. Server: npm publish + GH Release are created by CI on gate-pass.
EOF

if [[ -n "${SIBLING_VERSION}" ]]; then
  cat <<EOF

Note: this was a --with-sibling run — two INDEPENDENT versioned releases. Push
the toolkit too (its summary block above prints its own push command + the Asset
submission values). The two tags carry the SAME string but are independent
releases of two independent artifacts.
EOF
fi
