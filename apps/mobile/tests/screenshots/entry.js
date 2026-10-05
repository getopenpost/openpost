// Sample content runs only through the screenshot entry, never the shipping app.
const SystemDate = Date;
const captureTime = new SystemDate("2026-10-05T12:00:00Z").getTime();
global.Date = class extends SystemDate {
  constructor(...args) {
    super(...(args.length ? args : [captureTime]));
  }
  static now() {
    return captureTime;
  }
};
const { Image } = require("react-native");
const photo = Image.resolveAssetSource(
  require("../../../../tests/app/fixtures/product-screenshots/lisbon-tram.png"),
).uri;
const workspace = { id: "mobile-review", name: "Studio", organization_id: "review", role: "owner" };
const now = new Date();
const at = (day, hour) => new Date(now.getFullYear(), now.getMonth(), day, hour).toISOString();
const media = [
  { id: "image-one", url: photo, mime_type: "image/png", original_filename: "lisbon-tram.png" },
];
const account = {
  id: "demo-account",
  platform: "bluesky",
  slug: "studio",
  account_username: "studio.bsky.social",
  is_active: true,
};
const post = (id, text, status, day, hour, image = true) => ({
  id,
  title: "",
  source_text: text,
  status,
  revision: 1,
  workspace_id: workspace.id,
  content_profile: "short_text",
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
  scheduled_at: at(day, hour),
  actual_run_at: status === "published" ? at(day, hour) : undefined,
  media: image ? media : [],
  renditions: [
    {
      id: "rendition-" + id,
      social_account_id: account.id,
      body: text,
      platform: account.platform,
      status,
    },
  ],
});
const posts = [
  post("draft-one", "A few thoughts on building in public in 2026", "draft", 5, 9),
  post(
    "draft-two",
    "Starting to use Nix was the best decision for my development setup.",
    "draft",
    5,
    9,
    false,
  ),
  post(
    "draft-three",
    "Google added an image editor to Play Console. One less step before launching.",
    "draft",
    5,
    9,
    false,
  ),
  post(
    "published-one",
    "250 clicks from Google. Here is what changed.",
    "published",
    now.getDate(),
    9,
  ),
  post(
    "scheduled-one",
    "A new workspace for everything we create.",
    "scheduled",
    now.getDate() + 2,
    9,
  ),
  post(
    "scheduled-two",
    "What we learned while building the next release.",
    "scheduled",
    now.getDate() + 2,
    13,
    false,
  ),
];
const metric = (value, measured, delta) => ({
  value,
  measured,
  ...(delta === undefined ? {} : { delta }),
});
const series = Array.from({ length: 30 }, (_, i) => ({
  date: at(now.getDate() - 29 + i, 9).slice(0, 10),
  value: [12, 8, 24, 5, 47, 35, 18, 71, 26, 55][i % 10],
  platforms: { bluesky: [12, 8, 24, 5, 47, 35, 18, 71, 26, 55][i % 10] },
}));
const content = posts
  .filter((p) => p.status === "published")
  .map((p) => ({
    publication_id: p.id,
    title: p.title,
    excerpt: p.source_text,
    published_at: p.actual_run_at,
    metrics: { views: 1240, likes: 32 },
    measured: { views: 1 },
    engagement: 35,
    engagement_measured: 1,
    renditions: [],
  }));
const overview = {
  range_days: 30,
  content_total: 1,
  publication_total: 1,
  generated_at: now.toISOString(),
  accounts: [
    {
      ...account,
      username: account.account_username,
      metrics: { followers: 6910 },
      follower_delta: 157,
      status: "ok",
      account_supported: true,
      content_supported: true,
      stale: false,
      last_synced_at: now.toISOString(),
      metric_metadata: {},
    },
  ],
  content: content.map((p) => ({
    ...p,
    rendition_id: "result-one",
    account_id: account.id,
    platform: account.platform,
    username: account.account_username,
    reference: { type: "openpost", publication_id: p.publication_id, rendition_id: "result-one" },
    metric_availability: "available",
  })),
  publications: content,
  summary: {
    followers: metric(6910, 1, 157),
    engagement: metric(35, 1),
    views: metric(3810, 1),
    impressions: metric(0, 0),
    reach: metric(0, 0),
    published: 15,
  },
  trends: { views: series, followers: [], engagement: [] },
  insights: [],
};
const routes = new Map([
  [
    "/app/bootstrap",
    {
      authenticated: true,
      user: { id: "review", name: "Demo user", email: "demo@example.invalid" },
      workspaces: [workspace],
      selected_workspace_id: workspace.id,
      selected_workspace_settings: null,
    },
  ],
  ["/workspaces", [workspace]],
  ["/accounts", [account]],
  [
    "/social-sets",
    [{ id: "studio-set", name: "Shortform writing", is_default: true, accounts: [account] }],
  ],
  ["/posting-schedules/next-slot", { slot_time: at(now.getDate() + 1, 9) }],
  [
    "/video-projects",
    [
      {
        id: "project-one",
        name: "Building in public",
        sync_status: "synced",
        updated_at: now.toISOString(),
        created_at: now.toISOString(),
        revision: 1,
      },
    ],
  ],
]);

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

global.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = options.method || input.method || "GET";
  if (method !== "GET") return jsonResponse({ detail: "Screenshot data is read-only" }, 405);
  const path = url.pathname.replace(/^\/api\/v1/, "");
  let value = routes.get(path);
  if (path === "/publications") {
    value = posts.filter((p) =>
      url.searchParams.has("calendar_from")
        ? p.status !== "draft"
        : p.status === url.searchParams.get("activity_bucket"),
    );
  } else if (path.startsWith("/publications/")) {
    value = posts.find((p) => path === `/publications/${p.id}`);
  } else if (path === "/analytics") {
    value = { ...overview, range_days: Number(url.searchParams.get("days")) || 30 };
  }
  return value === undefined
    ? jsonResponse({ detail: `No screenshot fixture for ${path}` }, 404)
    : jsonResponse(value);
};
require("expo-router/entry");
