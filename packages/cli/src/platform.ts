export interface BinaryTarget {
  os: string;
  arch: string;
  extension: string;
}

// assetTarget maps the Node platform/arch pair onto a GitHub release asset
// triple. It covers exactly the matrix built by the release workflow's
// build-cli job; anything else fails with an install-time error that names
// the GitHub release page instead of a broken binary.
export function assetTarget(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): BinaryTarget {
  const key = `${platform}-${arch}`;
  switch (key) {
    case "linux-x64":
      return { os: "linux", arch: "amd64", extension: "" };
    case "linux-arm64":
      return { os: "linux", arch: "arm64", extension: "" };
    case "darwin-arm64":
      return { os: "darwin", arch: "arm64", extension: "" };
    case "win32-x64":
      return { os: "windows", arch: "amd64", extension: ".exe" };
    default:
      throw new Error(
        `OpenPost CLI has no prebuilt binary for ${key}. ` +
          `Supported targets are linux-x64, linux-arm64, darwin-arm64, and win32-x64. ` +
          `Download a release manually from https://github.com/getopenpost/openpost/releases ` +
          `or build apps/cli from source.`,
      );
  }
}

export function assetName(binary: "openpost-cli" | "openpost-mcp", target: BinaryTarget): string {
  return `${binary}-${target.os}-${target.arch}${target.extension}`;
}

export function checksumName(asset: string): string {
  return `${asset}.sha256`;
}
