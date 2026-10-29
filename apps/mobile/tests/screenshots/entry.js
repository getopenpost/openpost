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
const photoAsset = require("../../../../tests/app/fixtures/product-screenshots/lisbon-tram.png");
const photo = Image.resolveAssetSource
  ? Image.resolveAssetSource(photoAsset).uri
  : typeof photoAsset === "string"
    ? photoAsset
    : photoAsset.uri;
const workspace = {
  id: "mobile-review",
  name: "Studio",
  organization_id: "review",
  role: "owner",
  can_edit: true,
  can_connect: true,
  can_approve: true,
};
if (global.__OPENPOST_SCREENSHOT_VIEWER__ === true) {
  workspace.role = "viewer";
  workspace.can_edit = false;
  workspace.can_connect = false;
  workspace.can_approve = false;
}
const now = new Date();
const at = (day, hour) => new Date(now.getFullYear(), now.getMonth(), day, hour).toISOString();
const media = [
  {
    id: "image-one",
    url: photo,
    mime_type: "image/png",
    original_filename: "lisbon-tram.png",
    width: 1923,
    height: 818,
  },
];
const account = {
  id: "demo-account",
  platform: "bluesky",
  slug: "studio",
  account_username: "studio.bsky.social",
  is_active: true,
};
const accounts = [
  account,
  {
    ...account,
    id: "threads-account",
    platform: "threads",
    account_username: "studio",
  },
  { ...account, id: "x-account", platform: "x", account_username: "studio" },
  {
    ...account,
    id: "mastodon-account",
    platform: "mastodon",
    instance_url: "https://masto.pt",
    account_username: "studio",
  },
  {
    ...account,
    id: "linkedin-account",
    platform: "linkedin",
    account_username: "Studio team",
  },
  { ...account, id: "google-account", platform: "googlebusiness", account_username: "Studio" },
  {
    ...account,
    id: "facebook-account",
    platform: "facebook",
    account_username: "Studio",
  },
];
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
  renditions: accounts.map((destination) => ({
    id: "rendition-" + id + "-" + destination.id,
    social_account_id: destination.id,
    body: text,
    platform: destination.platform,
    status,
  })),
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
// Sample immutable review versions exercise the native inspection and decision controls.
const reviewPost = post("client-review", "The submitted launch copy", "draft", now.getDate(), 9);
reviewPost.review_state = "pending";
reviewPost.renditions = reviewPost.renditions.slice(0, 1);
reviewPost.renditions[0].segments = [
  {
    id: "review-segment",
    body: "The submitted launch copy",
    title: "Submitted launch title",
    description: "Submitted launch description",
    media,
    settings: { first_comment: "The submitted follow-up comment" },
  },
];
accounts.push({ ...account, id: "review-account-two", account_username: "studio.launches" });
reviewPost.renditions.push({
  ...reviewPost.renditions[0],
  id: "review-variant-two",
  social_account_id: "review-account-two",
});
posts.push(reviewPost);
const submittedReview = {
  id: "review-one",
  publication_id: reviewPost.id,
  workspace_id: workspace.id,
  epoch: 1,
  current: true,
  reviewer_id: "review",
  requested_by: "author",
  note: "Please review this launch version.",
  created_at: now.toISOString(),
  snapshot: JSON.parse(JSON.stringify(reviewPost)),
};
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
    metrics: { views: 1240, likes: 32, comments: 3 },
    metric_metadata: {},
    measurements: {},
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
    reference: {
      type: "openpost",
      publication_id: p.publication_id,
      rendition_id: "result-one",
    },
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
  trends: {
    views: series,
    followers: series.map((point) => ({
      ...point,
      value: point.value > 20 ? Math.round(point.value / 4) : -5,
    })),
    engagement: series.map((point) => ({
      ...point,
      value: Math.round(point.value / 4),
    })),
  },
  insights: [],
};
// Analytics fixtures include complete-population projections, independent of paging.
overview.summary.visibility = metric(1240, 1);
overview.summary.views = metric(1240, 1);
overview.summary.published = 1;
overview.trends.visibility = series;
overview.content = overview.content.map((post) => ({
  ...post,
  visibility: { value: 1240, metric: "views", basis: "content_views" },
}));
overview.highlights = overview.content;
overview.visibility_breakdown = [
  {
    platform: account.platform,
    metric: "views",
    basis: "content_views",
    value: 1240,
    measured: 1,
  },
];
overview.performance = [
  {
    account_id: account.id,
    platform: account.platform,
    username: account.account_username,
    published: 1,
    publication_count: 1,
    visibility: metric(1240, 1),
    engagement: metric(35, 1),
    followers: 6910,
    follower_delta: 157,
    status: "ok",
  },
];
overview.takeaways = [
  {
    kind: "repurpose_post",
    title: overview.content[0].title,
    excerpt: overview.content[0].excerpt,
    account_id: account.id,
    platform: account.platform,
    username: account.account_username,
    reference: overview.content[0].reference,
    value: 35,
    baseline: 12,
    measured_count: 5,
    comparison_sample: 4,
    reason: "above_account_engagement_baseline",
  },
];
overview.takeaways.push(
  {
    kind: "restore_measurements",
    account_id: "threads-account",
    platform: "threads",
    username: "studio",
    value: 0,
    measured_count: 0,
    comparison_sample: 0,
    reason: "permission_required",
  },
  {
    kind: "restore_measurements",
    account_id: "facebook-account",
    platform: "facebook",
    username: "Studio",
    value: 0,
    measured_count: 0,
    comparison_sample: 0,
    reason: "failed",
  },
);
const ideateDocument = {
  schema_version: 1,
  template_id: "messages",
  title: "A smaller codebase",
  appearance: "light",
  frame: "natural",
  text_size: "normal",
  conversation: {
    name: "The codebase",
    self_id: "me",
    show_header: true,
    timestamp: "Today 9:41 AM",
    read_receipt: "Read 9:42 AM",
    people: [
      { id: "me", name: "Me" },
      { id: "code", name: "The codebase" },
    ],
    messages: [
      { id: "one", sender_id: "me", text: "i deleted 15,000 lines" },
      {
        id: "two",
        sender_id: "code",
        text: "thanks. i have more features now",
      },
    ],
  },
};
const option = (id, label, text, media) => ({
  id,
  label,
  canonical_text: text,
  direction: {
    canonical_text: text,
    factual_kernel: ["The author deleted 15,000 lines and the product has more features."],
    thesis: "Less code, more features.",
    outcome: "shares",
    audience: "Builders",
    angle: label,
    route: media.treatment === "none" ? "thesis_led" : "artifact_led",
    claims: [],
    media,
    destinations: accounts.map((account) => ({
      account_id: account.id,
      include: true,
      reason: "Selected by the author.",
    })),
  },
  review_flags: [],
  destinations: accounts.map((account) => ({
    account_id: account.id,
    platform: account.platform,
    objective: "shares",
    archetype: media.treatment === "none" ? "observation" : "artifact_joke",
    output_profile: `${account.platform}.post`,
    preview: text || label,
    claims: [],
    follow_up_notes: [],
    segments: [{ body: text }],
    media,
    warnings: [],
    format_locked: false,
  })),
  skipped: [],
});
const ideateVoice = {
  id: "studio-voice",
  workspace_id: workspace.id,
  name: "Studio voice",
  is_default: true,
  revision: 1,
  schema_version: 1,
  definition: {
    identity_summary: "A founder building useful software.",
    preferred_language: "English",
    traits: ["Direct", "Dry humor"],
  },
  assigned_account_ids: [],
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
};
const ideateBuild = {
  id: "native-four-posts",
  workspace_id: workspace.id,
  state: "ready",
  phase: "ready",
  revision: 1,
  voice_profile_id: ideateVoice.id,
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
  input: {
    idea: "I deleted 15,000 lines and the product has more features now.",
    option_count: 4,
    destination_policy: "require_all",
    direction: {},
    destinations: accounts.map((account) => ({
      account_id: account.id,
      platform: account.platform,
      label: account.account_username,
      voice: {
        id: ideateVoice.id,
        name: ideateVoice.name,
        revision: 1,
        definition: {
          identity: ideateVoice.definition.identity_summary,
          language: "English",
        },
      },
      allowed_output_profiles: [
        {
          key: `${account.platform}.post`,
          text_limit: account.platform === "x" ? 280 : account.platform === "bluesky" ? 300 : 500,
          max_segments: 1,
          media_max_count: 4,
          allowed_mimes: ["image/*"],
        },
      ],
    })),
  },
  result: {
    canonical_text: "",
    destinations: [],
    direction: {},
    review_flags: [],
    skipped: [],
    sources: [],
    options: [
      option(
        "option-1",
        "The shorter version",
        "Deleted 15,000 lines.\n\nThe product has more features now.\n\nStarting to suspect the code was the bug.",
        { treatment: "none", role: "none", brief: "" },
      ),
      option("option-2", "A message from the codebase", "", {
        treatment: "template",
        template_id: "messages",
        role: "punchline",
        brief: "A fictional conversation with the codebase.",
        alt_text: "Me: i deleted 15,000 lines. The codebase: thanks. i have more features now.",
        document: ideateDocument,
      }),
      option(
        "option-3",
        "Show what changed",
        "15,000 lines gone. More features.\n\nHere’s what the product does now.",
        {
          treatment: "attach_video",
          role: "proof",
          brief: "Record a short walkthrough of the real product after the refactor.",
        },
      ),
      option(
        "option-4",
        "The engineering take",
        "Sometimes the best feature is the code you delete.\n\n15,000 lines gone. More features left.",
        { treatment: "none", role: "none", brief: "" },
      ),
    ],
  },
};
const routes = new Map([
  [
    "/app-branding/mobile-review",
    {
      workspace_id: workspace.id,
      organization_id: workspace.organization_id,
      organization_default: { display_name: "OpenPost" },
      organization_revision: 0,
      workspace_revision: 0,
      effective: global.__OPENPOST_SCREENSHOT_APP_BRANDING__ ?? { display_name: "OpenPost" },
      allow_workspace_override: false,
      can_manage_organization: false,
      can_manage_workspace: false,
    },
  ],
  ["/telemetry/config", { enabled: false, environment: "test", edition: "selfhost" }],
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
  ["/voice-profiles", [ideateVoice]],
  ["/publication-builds/native-four-posts", ideateBuild],
  ["/accounts", accounts],
  [
    "/social-sets",
    [
      {
        id: "studio-set",
        name: "Shortform writing",
        is_default: true,
        accounts: accounts.map((account) => ({
          social_account_id: account.id,
        })),
      },
    ],
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

const inboxSampleRequest = require("./inbox").createInboxSamples({
  workspace,
  accounts,
  media,
  now,
  SystemDate,
});
global.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = options.method || input.method || "GET";
  const path = url.pathname.replace(/^\/api\/v1/, "");
  const inboxResponse = await inboxSampleRequest(url, method, input, options);
  if (inboxResponse) return inboxResponse;
  if (method === "PUT" && path === "/publications/client-review/reviews/review-one") {
    const body = options.body ? JSON.parse(options.body) : await input.json();
    if (body.expected_epoch !== 1 || !["approved", "changes_requested"].includes(body.decision))
      return jsonResponse({ detail: "Invalid review decision" }, 409);
    submittedReview.decision = body.decision;
    submittedReview.feedback = body.feedback;
    reviewPost.review_state = body.decision;
    return jsonResponse(submittedReview);
  }
  if (method === "POST") {
    const body = options.body ? JSON.parse(options.body) : await input.json();
    if (path === "/publication-builds") {
      ideateBuild.state = "ready";
      return jsonResponse(ideateBuild, 202);
    }
    if (path === "/screenshot-templates/designs")
      return jsonResponse({
        id: "native-design",
        revision: 1,
        document: body.document,
        workspace_id: workspace.id,
      });
    if (path === "/media/upload-session") {
      if (body.mime_type !== "image/png" || body.source !== "screenshot_template")
        return jsonResponse({ detail: "Expected an editable PNG" }, 422);
      const fs = require("expo-file-system/legacy");
      const base64 = await fs.readAsStringAsync(`${fs.cacheDirectory}ideate-native-design.png`, {
        encoding: fs.EncodingType.Base64,
      });
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const width = new DataView(bytes.buffer).getUint32(16);
      const height = new DataView(bytes.buffer).getUint32(20);
      if (!base64.startsWith("iVBORw0KGgo") || width !== 1080 || !height)
        return jsonResponse({ detail: "Native artifact export was invalid" }, 422);
      global.ideateExport = {
        id: "native-png",
        url: `data:image/png;base64,${base64}`,
        mime_type: "image/png",
        original_filename: body.filename,
        width,
        height,
        alt_text: body.alt_text,
      };
      return jsonResponse({ media_id: "native-png", deduped: true });
    }
    if (
      path === "/media/upload-session/native-png/complete" ||
      path === "/screenshot-templates/designs/native-design/exports"
    )
      return jsonResponse({});
    if (path === "/publication-builds/native-four-posts/options/option-2/commit") {
      if (
        body.expected_revision !== ideateBuild.revision ||
        !global.ideateExport ||
        body.media?.length !== accounts.length ||
        body.edits?.some((edit) => edit.document?.template_id !== "messages")
      )
        return jsonResponse({ detail: "Incomplete native selection" }, 422);
      const chosen = post("chosen-ideate", "", "draft", 5, 9, false);
      chosen.scheduled_at = undefined;
      chosen.renditions = chosen.renditions.map((rendition) => ({
        ...rendition,
        media: [global.ideateExport],
        segments: [
          {
            id: `segment-${rendition.id}`,
            body: "",
            settings: {},
            media: [global.ideateExport],
          },
        ],
      }));
      posts.push(chosen);
      ideateBuild.state = "committed";
      ideateBuild.publication_id = chosen.id;
      return jsonResponse({ publication_id: chosen.id });
    }
  }
  if (method !== "GET") return jsonResponse({ detail: "Screenshot data is read-only" }, 405);
  let value = routes.get(path);
  if (path === "/publications") {
    value = posts.filter((p) =>
      url.searchParams.has("calendar_from")
        ? p.status !== "draft"
        : p.status === url.searchParams.get("activity_bucket"),
    );
  } else if (path === "/publications/client-review/reviews") {
    value = [submittedReview];
  } else if (path.startsWith("/publications/")) {
    value = posts.find((p) => path === `/publications/${p.id}`);
  } else if (path === "/analytics") {
    value = {
      ...overview,
      range_days: Number(url.searchParams.get("days")) || 30,
    };
  }
  return value === undefined
    ? jsonResponse({ detail: `No screenshot fixture for ${path}` }, 404)
    : jsonResponse(value);
};
const analyticsCapture =
  require("react-native").Platform.OS === "web" &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("analytics_capture");
if (analyticsCapture) {
  require("./analytics-harness");
} else if (require("react-native").Platform.OS === "web") {
  workspace.role = "client";
  workspace.can_edit = false;
  require("./review-harness");
} else require("expo-router/entry");
