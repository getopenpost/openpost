import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const guide = readFileSync(
  new URL("../apps/docs/content/docs/automate/api/media.mdx", import.meta.url),
  "utf8",
);
const mediaUploadExample = [...guide.matchAll(/```bash\n([\s\S]*?)```/g)]
  .map((match) => match[1])
  .join("\n");

const harness = String.raw`
set -eu
curl() {
  local joined
  joined="$(printf '%s ' "$@")"
  case "$joined" in
    *"/complete"*)
      printf '{"id":"media_complete"}'
      ;;
    *"/api/v1/media/upload-session "*)
      if [ "$TEST_UPLOAD_KIND" = "relative" ]; then
        printf '{"media_id":"media_pending","deduped":false,"upload":{"method":"PUT","url":"/api/v1/media/upload-session/media_pending/content","headers":{"Content-Type":"image/png","X-Test":"required"}},"complete_url":"/api/v1/media/upload-session/media_pending/complete"}'
      else
        printf '{"media_id":"media_pending","deduped":false,"upload":{"method":"PUT","url":"https://uploads.example/media_pending","headers":{"Content-Type":"image/png","X-Test":"required"}},"complete_url":"/api/v1/media/upload-session/media_pending/complete"}'
      fi
      ;;
    *)
      case "$joined" in
        *"Content-Type: image/png"*"X-Test: required"*) ;;
        *) printf 'missing returned upload headers: %s\n' "$joined" >&2; return 1 ;;
      esac
      if [ "$TEST_UPLOAD_KIND" = "relative" ]; then
        case "$joined" in
          *"https://app.openpo.st/api/v1/media/upload-session/media_pending/content"*"Authorization: Bearer test-token"*) ;;
          *) printf 'relative target was not resolved and authenticated: %s\n' "$joined" >&2; return 1 ;;
        esac
      else
        case "$joined" in
          *"https://uploads.example/media_pending"*) ;;
          *) printf 'external target was not preserved: %s\n' "$joined" >&2; return 1 ;;
        esac
        case "$joined" in
          *"Authorization: Bearer"*) printf 'token leaked to external target: %s\n' "$joined" >&2; return 1 ;;
          *) ;;
        esac
      fi
      ;;
  esac
}
OPENPOST_TOKEN=test-token
`;

function runExample(kind) {
  return spawnSync("bash", ["-c", `${harness}\n${mediaUploadExample}`], {
    encoding: "utf8",
    env: { ...process.env, TEST_UPLOAD_KIND: kind },
  });
}

describe("Automate HTTP media example", () => {
  test("parses as Bash", () => {
    const result = spawnSync("bash", ["-n"], { input: mediaUploadExample, encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  for (const kind of ["relative", "external"]) {
    test(`handles the ${kind} upload target`, () => {
      const result = runExample(kind);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    });
  }
});
