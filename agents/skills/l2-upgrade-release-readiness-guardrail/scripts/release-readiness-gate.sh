#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${1:-HEAD~1}"
OUT_DIR="${2:-agents/skills/l2-upgrade-release-readiness-guardrail/out}"

mkdir -p "${OUT_DIR}"

PUBLIC_API_REPORT_MD="${OUT_DIR}/public-api-report.md"
PUBLIC_API_REPORT_JSON="${OUT_DIR}/public-api-report.json"
PACK_DRY_RUN_TXT="${OUT_DIR}/npm-pack-dry-run.txt"
SUMMARY_TXT="${OUT_DIR}/release-gate-summary.txt"
NPM_CACHE_DIR="${OUT_DIR}/.npm-cache"

mkdir -p "${NPM_CACHE_DIR}"

echo "[gate] base ref: ${BASE_REF}"

api_exit=0
if ! node agents/skills/l2-upgrade-public-api-guardrail/scripts/check-public-api.mjs \
  --base "${BASE_REF}" \
  --report "${PUBLIC_API_REPORT_MD}" \
  --json "${PUBLIC_API_REPORT_JSON}"; then
  api_exit=$?
fi

state_exit=0
if ! bash agents/skills/l2-upgrade-state-invariant-guardrail/scripts/check-state-manager-guards.sh; then
  state_exit=$?
fi

build_exit=0
if ! npm run build; then
  build_exit=$?
fi

tx_exit=0
if ! node agents/skills/l2-upgrade-tx-crypto-guardrail/scripts/tx-crypto-smoke.mjs; then
  tx_exit=$?
fi

pack_exit=0
if ! npm pack --dry-run --cache "${NPM_CACHE_DIR}" > "${PACK_DRY_RUN_TXT}" 2>&1; then
  pack_exit=$?
fi

artifact_exit=0
if [[ "${pack_exit}" -eq 0 ]]; then
  for required in "dist/index.js" "dist/index.d.ts" "dist/cjs/index.js"; do
    if ! rg -Fq "${required}" "${PACK_DRY_RUN_TXT}"; then
      echo "[missing] npm pack artifact: ${required}" >&2
      artifact_exit=6
    fi
  done
fi

semver_exit=0
if ! node - "${BASE_REF}" "${PUBLIC_API_REPORT_JSON}" > "${OUT_DIR}/semver-check.txt" <<'NODE'
const { execSync } = require('node:child_process')
const { readFileSync } = require('node:fs')

const baseRef = process.argv[2]
const reportPath = process.argv[3]

const parseVersion = (v) => {
  const m = String(v).trim().match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

const bumpType = (a, b) => {
  if (!a || !b) return 'invalid'
  if (b.major > a.major) return 'major'
  if (b.major === a.major && b.minor > a.minor) return 'minor'
  if (b.major === a.major && b.minor === a.minor && b.patch > a.patch) return 'patch'
  if (b.major === a.major && b.minor === a.minor && b.patch === a.patch) return 'same'
  return 'decrease'
}

const currentPkg = JSON.parse(readFileSync('package.json', 'utf8'))
const currentVersion = parseVersion(currentPkg.version)

let baseVersion = null
try {
  const basePkgRaw = execSync(`git show ${JSON.stringify(baseRef)}:package.json`, { encoding: 'utf8' })
  const basePkg = JSON.parse(basePkgRaw)
  baseVersion = parseVersion(basePkg.version)
} catch {
  // keep null; handled by invalid bump type
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'))
const bump = bumpType(baseVersion, currentVersion)
const breaking = Number(report.breaking || 0)

console.log(`baseVersion=${baseVersion ? `${baseVersion.major}.${baseVersion.minor}.${baseVersion.patch}` : 'unknown'}`)
console.log(`currentVersion=${currentVersion ? `${currentVersion.major}.${currentVersion.minor}.${currentVersion.patch}` : 'unknown'}`)
console.log(`bumpType=${bump}`)
console.log(`breakingCount=${breaking}`)

if (breaking > 0 && bump !== 'major') {
  console.error('Breaking API changes require a major version bump.')
  process.exit(5)
}
if (bump === 'decrease') {
  console.error('Version must not decrease from base ref.')
  process.exit(5)
}
if (bump === 'invalid') {
  console.error('Cannot evaluate semver bump; check package.json versions.')
  process.exit(5)
}
NODE
then
  semver_exit=$?
fi

{
  echo "base_ref=${BASE_REF}"
  echo "api_exit=${api_exit}"
  echo "state_exit=${state_exit}"
  echo "build_exit=${build_exit}"
  echo "tx_exit=${tx_exit}"
  echo "pack_exit=${pack_exit}"
  echo "artifact_exit=${artifact_exit}"
  echo "semver_exit=${semver_exit}"
} > "${SUMMARY_TXT}"

echo "[gate] summary saved: ${SUMMARY_TXT}"

for code in "${api_exit}" "${state_exit}" "${build_exit}" "${tx_exit}" "${pack_exit}" "${artifact_exit}" "${semver_exit}"; do
  if [[ "${code}" -ne 0 ]]; then
    echo "[gate] failed" >&2
    exit "${code}"
  fi
done

echo "[gate] passed"
