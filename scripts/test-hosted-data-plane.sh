#!/usr/bin/env bash
# Hosted PostgreSQL and S3 integration tests. CI runs them against service
# containers; locally, start `devenv up --profile hosted` first.
set -euo pipefail

: "${OPENPOST_TEST_POSTGRES_URL:?set OPENPOST_TEST_POSTGRES_URL (devenv --profile hosted sets it)}"
: "${OPENPOST_TEST_S3_ENDPOINT:?set OPENPOST_TEST_S3_ENDPOINT}"

cd "$(git rev-parse --show-toplevel)/apps/server"
report="${OPENPOST_HOSTED_REPORT:-hosted-data-plane.json}"

go test -tags dev -count=1 -json \
  ./internal/database \
  ./internal/database/migrations \
  ./internal/queue \
  ./internal/services/apitokens \
  ./internal/services/billing \
  ./internal/services/credentialguard \
  ./internal/services/feedback \
  ./internal/services/medialifecycle \
  ./internal/services/mediastore \
  ./internal/services/providerwrite \
  ./internal/services/tokenmanager \
  > "$report" || status=$?
go test -tags dev -count=1 -json ./internal/api/handlers \
  -run '^TestListPublicationEventsPostgres$' >> "$report" || status=$?
jq -r 'select(.Action == "fail" and .Test != null) | "FAIL " + .Package + ": " + .Test' "$report"
[[ "${status:-0}" == 0 ]] || exit "$status"

# A skipped integration test means its service was not reached.
if jq -s -e 'any(.[]; .Action == "skip" and .Test != null)' "$report" >/dev/null; then
  echo "A hosted data-plane test was skipped:" >&2
  jq -r 'select(.Action == "skip" and .Test != null) | .Package + ": " + .Test' "$report" >&2
  exit 1
fi
for required in \
  TestListPublicationEventsPostgres \
  TestRevisionMediaReferencesMigrationPostgres \
  TestPostgresWorkersClaimDifferentDueJobsWithoutWaiting \
  TestS3CompatibleStorageIntegration; do
  jq -e --arg test "$required" 'select(.Action == "pass" and .Test == $test)' "$report" >/dev/null || {
    echo "Required hosted data-plane test did not pass: $required" >&2
    exit 1
  }
done
echo "Hosted data-plane tests passed."
