import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ditherThreshold } from "../apps/web/src/lib/components/dither/paint.ts";

export const DEFAULT_REPOSITORY = "getopenpost/openpost";
export const BADGE_NAMES = ["downloads", "release", "build", "stars"];

const COLORS = {
  downloads: {
    light: ["#dff4e4", "#9ed9ad", "#173d24", "#102117"],
    dark: ["#183022", "#72d18d", "#e7f8eb", "#102117"],
  },
  release: {
    light: ["#ffe5d0", "#f3b77f", "#4c210d", "#2a160b"],
    dark: ["#3b2416", "#ffad66", "#fff0e2", "#2a160b"],
  },
  build: {
    passing: {
      light: ["#e2f1e8", "#a8ddb8", "#173d24", "#102117"],
      dark: ["#183022", "#72d18d", "#e7f8eb", "#102117"],
    },
    failing: {
      light: ["#f9e1e1", "#ef9a9a", "#4d1616", "#2b0e0e"],
      dark: ["#3b1e20", "#ff8585", "#ffeaea", "#2b0e0e"],
    },
    pending: {
      light: ["#e2ebf4", "#a8c4dc", "#172a3b", "#0f1c28"],
      dark: ["#1e2d3b", "#9fc3e4", "#e7f2fc", "#0f1c28"],
    },
  },
  stars: {
    light: ["#fff1bc", "#ffd45c", "#382600", "#201500"],
    dark: ["#3c3214", "#ffd45c", "#fff7d6", "#211900"],
  },
};

function usage() {
  return "usage: bun scripts/generate-readme-badges.mjs [--repo owner/name] [--output-dir assets/badges]";
}

export function parseArguments(argv) {
  const options = {
    repository: DEFAULT_REPOSITORY,
    outputDir: "assets/badges",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo") {
      options.repository = argv[++index];
    } else if (argument === "--output-dir") {
      options.outputDir = argv[++index];
    } else if (argument === "--help") {
      console.log(usage());
      return null;
    } else {
      throw new Error(`Unknown argument: ${argument}\n${usage()}`);
    }
  }
  if (!/^[^/]+\/[^/]+$/.test(options.repository))
    throw new Error(`Invalid repository: ${options.repository}`);
  if (!options.outputDir) throw new Error("Output directory cannot be empty");
  return options;
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubJSON(url, token, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: githubHeaders(token) });
  if (!response.ok)
    throw new Error(`GitHub API request failed (${response.status})`);
  return response.json();
}

export async function fetchBadgeData(
  repository,
  {
    token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    fetchImpl = fetch,
  } = {},
) {
  const encodedRepository = repository
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const base = `https://api.github.com/repos/${encodedRepository}`;
  const [repo, release, workflow] = await Promise.all([
    githubJSON(base, token, fetchImpl),
    githubJSON(`${base}/releases/latest`, token, fetchImpl),
    githubJSON(
      `${base}/actions/workflows/ci.yml/runs?branch=main&per_page=1`,
      token,
      fetchImpl,
    ),
  ]);

  let downloads = 0;
  for (let page = 1; ; page += 1) {
    const releases = await githubJSON(
      `${base}/releases?per_page=100&page=${page}`,
      token,
      fetchImpl,
    );
    if (!Array.isArray(releases))
      throw new Error("GitHub releases response was not an array");
    for (const item of releases) {
      if (!item || !Array.isArray(item.assets))
        throw new Error("GitHub release was missing an assets array");
      if (item.draft) continue;
      for (const asset of item.assets) {
        if (!asset || typeof asset !== "object")
          throw new Error("GitHub returned an invalid release asset");
        if (
          !Number.isSafeInteger(asset.download_count) ||
          asset.download_count < 0
        ) {
          throw new Error("GitHub returned an invalid release download count");
        }
        downloads += asset.download_count;
        if (!Number.isSafeInteger(downloads))
          throw new Error(
            "GitHub release downloads exceeded the safe integer limit",
          );
      }
    }
    if (releases.length < 100) break;
  }

  if (
    !Number.isSafeInteger(repo.stargazers_count) ||
    repo.stargazers_count < 0
  ) {
    throw new Error("GitHub returned an invalid star count");
  }
  if (typeof release.tag_name !== "string" || !release.tag_name) {
    throw new Error("GitHub returned an invalid latest release");
  }
  if (!workflow || !Array.isArray(workflow.workflow_runs))
    throw new Error(
      "GitHub workflow response was missing a workflow_runs array",
    );
  const latestRun = workflow.workflow_runs[0];
  const build =
    latestRun?.status !== "completed"
      ? "pending"
      : latestRun.conclusion === "success"
        ? "passing"
        : ["failure", "timed_out", "action_required"].includes(
              latestRun.conclusion,
            )
          ? "failing"
          : "pending";
  return {
    downloads,
    release: release.tag_name,
    build,
    stars: repo.stargazers_count,
  };
}

function escapeXML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character],
  );
}

function textWidth(value) {
  return Math.max(28, [...String(value)].length * 7.2 + 16);
}

function ditherPattern() {
  const cell = 2;
  const rects = [];
  for (let row = 0; row < 14; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const density = row / 13;
      const lit = ditherThreshold(column, row) < density;
      const alpha = (0.08 + density * 0.42) * (lit ? 1 : 0.25);
      rects.push(
        `<rect x="${column * cell}" y="${row * cell}" width="${cell}" height="${cell}" fill="#fff" fill-opacity="${alpha.toFixed(3)}"/>`,
      );
    }
  }
  return `<pattern id="dither" width="8" height="28" patternUnits="userSpaceOnUse">${rects.join("")}</pattern>`;
}

export function renderBadge(kind, value, mode) {
  if (!BADGE_NAMES.includes(kind)) throw new Error(`Unknown badge: ${kind}`);
  const labels = {
    downloads: "downloads",
    release: "release",
    build: "build",
    stars: "stars",
  };
  const label = labels[kind];
  const displayValue = String(value);
  const labelWidth = textWidth(label);
  const valueWidth = textWidth(displayValue);
  const width = labelWidth + valueWidth;
  const palette =
    kind === "build" ? COLORS.build[displayValue]?.[mode] : COLORS[kind][mode];
  if (!palette) throw new Error(`Unknown ${kind} value: ${displayValue}`);
  const [labelBackground, valueBackground, labelInk, valueInk] = palette;
  const valueX = labelWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="28" viewBox="0 0 ${Math.ceil(width)} 28" role="img" aria-labelledby="title desc" shape-rendering="crispEdges"><title id="title">${escapeXML(label)}: ${escapeXML(displayValue)}</title><desc id="desc">OpenPost ${escapeXML(label)} badge</desc><defs><clipPath id="badge-clip"><rect width="${Math.ceil(width)}" height="28" rx="6"/></clipPath>${ditherPattern()}</defs><g clip-path="url(#badge-clip)"><rect width="${Math.ceil(width)}" height="28" fill="${labelBackground}"/><rect x="${valueX}" width="${valueWidth}" height="28" fill="${valueBackground}"/><rect x="${valueX}" width="${valueWidth}" height="28" fill="url(#dither)"/></g><path d="M6 0h${Math.ceil(width) - 12}a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V6A6 6 0 0 1 6 0Z" fill="none" stroke="#000" stroke-opacity="0.12"/><g fill="${labelInk}" font-family="Geist,Arial,sans-serif" font-size="12" font-weight="600" dominant-baseline="middle"><text x="8" y="14">${escapeXML(label)}</text></g><text x="${valueX + valueWidth / 2}" y="14" fill="${valueInk}" font-family="Geist,Arial,sans-serif" font-size="12" font-weight="700" text-anchor="middle" dominant-baseline="middle">${escapeXML(displayValue)}</text></svg>`;
}

export async function writeBadges(data, outputDir) {
  const destination = resolve(outputDir);
  const files = [];
  for (const kind of BADGE_NAMES) {
    for (const mode of ["light", "dark"]) {
      files.push({
        path: `${destination}/${kind}-${mode}.svg`,
        content: renderBadge(kind, data[kind], mode),
      });
    }
  }
  await mkdir(destination, { recursive: true });
  await Promise.all(
    files.map(({ path, content }) => writeFile(path, `${content}\n`, "utf8")),
  );
  return files.map(({ path }) => path);
}

if (import.meta.main) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (!options) process.exit(0);
    const data = await fetchBadgeData(options.repository);
    await writeBadges(data, options.outputDir);
    console.log(
      `Updated ${BADGE_NAMES.length * 2} README badges for ${options.repository}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
