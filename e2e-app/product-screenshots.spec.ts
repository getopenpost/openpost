import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const captureEnabled = process.env.OPENPOST_UPDATE_PRODUCT_SCREENSHOTS === "1";
const screenshotDirectory = fileURLToPath(new URL("../assets/screenshots/", import.meta.url));
const fixtureDirectory = fileURLToPath(new URL("./fixtures/product-screenshots/", import.meta.url));
const captureViewport = { width: 1440, height: 960 };
const fixedNow = "2026-08-20T14:30:00.000Z";
const rasterFixtureFiles = {
  "rodrigo-avatar": "rodrigo-avatar.png",
  "command-review": "command-review.png",
  "lisbon-tram": "lisbon-tram.png",
  "openpost-logo": "openpost-logo.png",
} as const;
type RasterFixtureKey = keyof typeof rasterFixtureFiles;
const rodrigoAvatarURL = `/marketing-fixtures/${rasterFixtureFiles["rodrigo-avatar"]}`;

const connectedAccounts = [
  {
    id: "account-linkedin",
    slug: "linkedin-rodrigo",
    platform: "linkedin",
    account_id: "linkedin-rodrigo",
    account_username: "Rodrigo",
    account_avatar_url: rodrigoAvatarURL,
    instance_url: "",
    is_active: true,
    thread_replies_supported: true,
  },
  {
    id: "account-threads",
    slug: "threads-rodrgds",
    platform: "threads",
    account_id: "threads-rodrgds",
    account_username: "rodrgds",
    account_avatar_url: rodrigoAvatarURL,
    instance_url: "",
    is_active: true,
    thread_replies_supported: true,
  },
  {
    id: "account-x",
    slug: "x-rodrgds",
    platform: "x",
    account_id: "x-rodrgds",
    account_username: "rodrgds",
    account_avatar_url: rodrigoAvatarURL,
    instance_url: "",
    is_active: true,
    thread_replies_supported: true,
  },
  {
    id: "account-youtube",
    slug: "youtube-rodrgds",
    platform: "youtube",
    account_id: "youtube-rodrgds",
    account_username: "rodrgds",
    account_avatar_url: rodrigoAvatarURL,
    instance_url: "",
    is_active: true,
    thread_replies_supported: false,
  },
  {
    id: "account-mastodon",
    slug: "mastodon-rgo",
    platform: "mastodon",
    account_id: "mastodon-rgo",
    account_username: "rgo",
    account_avatar_url: rodrigoAvatarURL,
    instance_url: "https://masto.pt",
    is_active: true,
    thread_replies_supported: true,
  },
  {
    id: "account-bluesky",
    slug: "bluesky-rgo-pt",
    platform: "bluesky",
    account_id: "bluesky-rgo-pt",
    account_username: "rgo.pt",
    account_avatar_url: rodrigoAvatarURL,
    instance_url: "",
    is_active: true,
    thread_replies_supported: true,
  },
];

function connectionReadiness(state: string, connectable: boolean, blocker?: string) {
  return {
    state,
    executable: connectable,
    connectable,
    publishable: false,
    advertisable: false,
    facts: {
      configuration: state === "needs_configuration" ? "missing" : "configured",
      local_test: "unknown",
      live_certification: "unknown",
      approval: "unknown",
      authorization: "unknown",
      control: "enabled",
      policy: "allowed",
    },
    blockers: blocker ? [{ code: blocker }] : [],
  };
}

const providerFixtures = [
  {
    platform: "x",
    display_name: "X",
    auth_mode: "oauth",
    configured: true,
    status: "available",
    readiness: connectionReadiness("healthy", true),
    description: "Connect an X account.",
  },
  {
    platform: "mastodon",
    display_name: "Mastodon",
    auth_mode: "oauth_oob",
    configured: true,
    status: "available",
    readiness: connectionReadiness("healthy", true),
    description: "Connect any public Mastodon instance.",
  },
  {
    platform: "bluesky",
    display_name: "Bluesky",
    auth_mode: "app_password",
    configured: true,
    status: "available",
    readiness: connectionReadiness("healthy", true),
    description: "Connect with an app password.",
  },
  {
    platform: "linkedin",
    display_name: "LinkedIn",
    auth_mode: "oauth",
    configured: true,
    status: "available",
    readiness: connectionReadiness("healthy", true),
    description: "Connect a LinkedIn profile.",
  },
  {
    platform: "threads",
    display_name: "Threads",
    auth_mode: "oauth",
    configured: true,
    status: "available",
    readiness: connectionReadiness("healthy", true),
    description: "Connect a Threads profile.",
  },
  {
    platform: "facebook",
    display_name: "Facebook Pages",
    auth_mode: "oauth",
    configured: false,
    status: "needs_configuration",
    readiness: connectionReadiness("needs_configuration", false, "missing_configuration"),
    description: "Requires a Meta provider app.",
  },
  {
    platform: "instagram",
    display_name: "Instagram Business",
    auth_mode: "oauth",
    configured: false,
    status: "needs_configuration",
    readiness: connectionReadiness("needs_configuration", false, "missing_configuration"),
    description: "Requires a Meta provider app.",
  },
  {
    platform: "tiktok",
    display_name: "TikTok",
    auth_mode: "oauth",
    configured: false,
    status: "needs_configuration",
    readiness: connectionReadiness("needs_configuration", false, "missing_configuration"),
    description: "Requires a reviewed TikTok provider app.",
  },
  {
    platform: "youtube",
    display_name: "YouTube",
    auth_mode: "oauth",
    configured: true,
    status: "available",
    readiness: connectionReadiness("healthy", true),
    description: "Connect a YouTube channel.",
  },
];

const mediaFixtures = [
  {
    id: "media-launch",
    filename: "command-review.png",
    artwork: "command-review",
    width: 765,
    height: 600,
    size: 306_269,
    favorite: true,
    usage: 3,
    canDelete: false,
  },
  {
    id: "media-workflow",
    filename: "openpost-workflow.png",
    artwork: "workflow",
    width: 1200,
    height: 1200,
    size: 189_440,
    favorite: false,
    usage: 1,
    canDelete: false,
  },
  {
    id: "media-release",
    filename: "release-notes.png",
    artwork: "release",
    width: 1080,
    height: 1350,
    size: 312_080,
    favorite: true,
    usage: 0,
    canDelete: true,
  },
  {
    id: "media-calendar",
    filename: "content-calendar.png",
    artwork: "calendar",
    width: 1600,
    height: 1000,
    size: 276_900,
    favorite: false,
    usage: 2,
    canDelete: false,
  },
  {
    id: "media-library",
    filename: "media-library.png",
    artwork: "library",
    width: 1400,
    height: 1050,
    size: 221_640,
    favorite: false,
    usage: 0,
    canDelete: true,
  },
  {
    id: "media-mark",
    filename: "openpost-mark.png",
    artwork: "mark",
    width: 1200,
    height: 1200,
    size: 142_260,
    favorite: true,
    usage: 4,
    canDelete: false,
  },
  {
    id: "media-rgo",
    filename: "rgo-dot-pt.png",
    artwork: "rgo",
    width: 1600,
    height: 1000,
    size: 198_120,
    favorite: false,
    usage: 1,
    canDelete: false,
  },
];

const imageEditorBackgroundFixture = {
  id: "media-editor-background",
  filename: "lisbon-tram.png",
  artwork: "lisbon-tram",
  width: 1923,
  height: 818,
  size: 1_996_336,
  favorite: true,
  usage: 1,
  canDelete: false,
};
const imageEditorLogoFixture = {
  id: "media-editor-logo",
  filename: "logo.png",
  artwork: "openpost-logo",
  width: 512,
  height: 512,
  size: 10_994,
  favorite: true,
  usage: 1,
  canDelete: false,
};
const editorMediaFixtures = [imageEditorBackgroundFixture, imageEditorLogoFixture];

const allMediaFixtures = [...mediaFixtures, ...editorMediaFixtures];

const artwork = {
  workflow: `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
      <rect width="1200" height="1200" fill="#f3efe8"/><g fill="none" stroke="#292524" stroke-width="18"><path d="M215 330h770M215 600h770M215 870h770"/></g>
      <g fill="#ea580c"><circle cx="300" cy="330" r="68"/><circle cx="600" cy="600" r="68"/><circle cx="900" cy="870" r="68"/></g>
      <text x="160" y="1080" fill="#292524" font-family="system-ui,sans-serif" font-size="64" font-weight="700">Draft · Adapt · Schedule</text>
    </svg>`,
  release: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350">
      <rect width="1080" height="1350" fill="#1c1917"/><rect x="120" y="145" width="840" height="1060" rx="60" fill="#292524" stroke="#57534e" stroke-width="8"/>
      <rect x="210" y="345" width="480" height="28" rx="14" fill="#fb923c"/><rect x="210" y="470" width="660" height="24" rx="12" fill="#78716c"/><rect x="210" y="550" width="570" height="24" rx="12" fill="#78716c"/>
      <rect x="210" y="810" width="260" height="110" rx="55" fill="#f97316"/><text x="210" y="275" fill="#fafaf9" font-family="system-ui,sans-serif" font-size="54" font-weight="700">Release notes</text>
    </svg>`,
  calendar: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000">
      <rect width="1600" height="1000" fill="#172554"/><g fill="#dbeafe" opacity=".96"><rect x="170" y="120" width="1260" height="760" rx="48"/></g>
      <g fill="#bfdbfe"><rect x="260" y="280" width="250" height="150" rx="24"/><rect x="550" y="280" width="250" height="150" rx="24"/><rect x="840" y="280" width="500" height="150" rx="24"/><rect x="260" y="475" width="450" height="245" rx="24"/><rect x="750" y="475" width="590" height="245" rx="24"/></g>
      <circle cx="1250" cy="790" r="62" fill="#f97316"/><path d="m1221 790 21 21 39-46" fill="none" stroke="white" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  library: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 1050">
      <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#134e4a"/><stop offset="1" stop-color="#5eead4"/></linearGradient></defs><rect width="1400" height="1050" fill="url(#g)"/>
      <g fill="#f0fdfa" opacity=".92"><rect x="165" y="110" width="485" height="365" rx="42"/><rect x="750" y="110" width="485" height="365" rx="42"/><rect x="165" y="570" width="485" height="365" rx="42"/><rect x="750" y="570" width="485" height="365" rx="42"/></g>
      <g fill="#0f766e"><circle cx="408" cy="293" r="86"/><path d="m820 405 105-115 80 75 78-100 90 140Z"/><rect x="270" y="680" width="275" height="34" rx="17"/><rect x="855" y="680" width="275" height="34" rx="17"/></g>
    </svg>`,
  mark: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
      <rect width="1200" height="1200" fill="#171412"/><g fill="#b74c05"><path d="M170 170h365v365H170zM665 170h365v365H665zM170 665h365v365H170z"/><path d="m665 665 365 365V665z"/></g><path d="m535 535 130 130-130 130-130-130z" fill="#fffaf4"/>
    </svg>`,
  rgo: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000">
      <rect width="1600" height="1000" fill="#eee8e2"/><rect x="90" y="90" width="1420" height="820" rx="52" fill="#fffaf4" stroke="#302b28" stroke-width="5"/>
      <text x="170" y="410" fill="#302b28" font-family="system-ui,sans-serif" font-size="180" font-weight="760">rgo.pt</text><rect x="175" y="515" width="780" height="28" rx="14" fill="#b74c05"/>
      <text x="175" y="650" fill="#6f655f" font-family="system-ui,sans-serif" font-size="46">Notes on software, design, and the work.</text>
    </svg>`,
} as const;

function mediaFixtureURL(artworkKey: string): string {
  const rasterFilename = rasterFixtureFiles[artworkKey as RasterFixtureKey];
  if (rasterFilename) return `/marketing-fixtures/${rasterFilename}`;
  return `/marketing-fixtures/${artworkKey}.svg`;
}

async function uploadImageFixture(
  request: APIRequestContext,
  token: string,
  workspaceID: string,
  filename: string,
  image: Buffer,
): Promise<string> {
  const response = await request.post("/api/v1/media/upload", {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      workspace_id: workspaceID,
      source: "upload",
      asset_kind: "library",
      retention_class: "library",
      file: {
        name: filename,
        mimeType: "image/png",
        buffer: image,
      },
    },
  });
  if (!response.ok()) {
    throw new Error(`Could not upload ${filename}: ${await response.text()}`);
  }
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error(`Upload for ${filename} returned no media ID`);
  return body.id;
}

function publicationFixture(
  workspaceID: string,
  id: string,
  status: "draft" | "scheduled" | "published",
  title: string,
  occursAt: string,
  accountIDs: string[],
) {
  const accounts = accountIDs
    .map((accountID) => connectedAccounts.find((account) => account.id === accountID))
    .filter((account): account is (typeof connectedAccounts)[number] => Boolean(account));
  return {
    id,
    workspace_id: workspaceID,
    created_by: "readme-demo-user",
    title,
    intent: "post",
    content_profile: "short_text",
    source_text: title,
    source_url: "",
    goal: "",
    audience: "",
    status,
    revision: 1,
    scheduled_at: status === "scheduled" ? occursAt : "",
    actual_run_at: status === "published" ? occursAt : "",
    created_at: occursAt,
    updated_at: occursAt,
    metadata: {},
    renditions: accounts.map((account, index) => ({
      id: `${id}-rendition-${index}`,
      publication_id: id,
      social_account_id: account.id,
      platform: account.platform,
      status,
      position: index,
      settings: {},
      media: [],
    })),
    segments: [
      {
        id: `${id}-segment`,
        position: 0,
        body: title,
        title: "",
        description: "",
        url: "",
        settings: {},
        media: [],
      },
    ],
    media: [],
  };
}

function analyticsFixture() {
  const rangeDates = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 6, 22 + index));
    return date.toISOString().slice(0, 10);
  });
  const followerSeries = [
    6744, 6747, 6747, 6746, 6749, 6752, 6755, 6754, 6758, 6762, 6765, 6771, 6770, 6777, 6781, 6790,
    6794, 6801, 6806, 6812, 6820, 6831, 6837, 6845, 6852, 6860, 6870, 6882, 6890, 6901,
  ].map((value, index) => ({ date: rangeDates[index], value }));
  const posts = [
    {
      key: "analytics-rendition-publishing",
      label: "The boring part of publishing should stay boring",
      platform: "threads",
      publication_id: "analytics-publication",
    },
    {
      key: "analytics-rendition-launch-week",
      label: "A calmer way to run launch week",
      platform: "linkedin",
      publication_id: "analytics-publication-launch-week",
    },
    {
      key: "analytics-rendition-daily-shipping",
      label: "What we learned from shipping every day",
      platform: "youtube",
      publication_id: "analytics-publication-daily-shipping",
    },
    {
      key: "analytics-rendition-wayland",
      label: "Finally moved over to Wayland",
      platform: "x",
      publication_id: "analytics-publication-wayland",
    },
    {
      key: "analytics-rendition-image-tools",
      label: "Image tools should make the result easier to share",
      platform: "bluesky",
      publication_id: "analytics-publication-image-tools",
    },
    {
      key: "analytics-rendition-release-notes",
      label: "The release notes people actually read",
      platform: "mastodon",
      publication_id: "analytics-publication-release-notes",
    },
    {
      key: "analytics-rendition-small-fixes",
      label: "Small fixes compound",
      platform: "threads",
      publication_id: "analytics-publication-small-fixes",
    },
    {
      key: "analytics-rendition-queue",
      label: "Why the queue lives in the database",
      platform: "linkedin",
      publication_id: "analytics-publication-queue",
    },
    {
      key: "analytics-rendition-studio",
      label: "A first look at OpenPost Studio",
      platform: "youtube",
      publication_id: "analytics-publication-studio",
    },
    {
      key: "analytics-rendition-provider-rules",
      label: "Every social app has different rules",
      platform: "x",
      publication_id: "analytics-publication-provider-rules",
    },
    {
      key: "analytics-rendition-content-calendar",
      label: "Planning a month without filling every day",
      platform: "bluesky",
      publication_id: "analytics-publication-content-calendar",
    },
    {
      key: "analytics-rendition-founder-workflow",
      label: "The content workflow I use as a solo founder",
      platform: "mastodon",
      publication_id: "analytics-publication-founder-workflow",
    },
  ] as const;
  type TrendSegment = readonly [postIndex: number, value: number];
  const viewSegments: TrendSegment[][] = [
    [],
    [[6, 86]],
    [[7, 3]],
    [],
    [[8, 14]],
    [],
    [[9, 136]],
    [[10, 101]],
    [[11, 2]],
    [],
    [[3, 14]],
    [[8, 211]],
    [[2, 18]],
    [
      [5, 47],
      [1, 5],
    ],
    [[5, 308]],
    [[9, 31]],
    [[2, 432]],
    [[2, 6]],
    [[10, 29]],
    [[2, 4]],
    [[0, 928]],
    [
      [0, 320],
      [1, 258],
    ],
    [
      [3, 15],
      [2, 7],
    ],
    [
      [3, 194],
      [1, 80],
    ],
    [[3, 94]],
    [
      [11, 82],
      [0, 6],
    ],
    [[0, 8]],
    [[8, 46]],
    [[11, 202]],
    [[5, 143]],
  ];
  const engagementSegments: TrendSegment[][] = [
    [],
    [[6, 3]],
    [[7, 1]],
    [],
    [[8, 1]],
    [],
    [[9, 5]],
    [[10, 4]],
    [],
    [],
    [[3, 2]],
    [[8, 8]],
    [[2, 1]],
    [
      [5, 2],
      [1, 1],
    ],
    [[5, 11]],
    [[9, 2]],
    [[2, 18]],
    [],
    [[10, 2]],
    [],
    [[0, 36]],
    [
      [0, 13],
      [1, 10],
    ],
    [
      [3, 1],
      [2, 1],
    ],
    [
      [3, 8],
      [1, 3],
    ],
    [[3, 5]],
    [
      [11, 4],
      [0, 1],
    ],
    [[0, 1]],
    [[8, 3]],
    [[11, 8]],
    [[5, 7]],
  ];
  const buildContentTrend = (segmentsByDay: TrendSegment[][]) =>
    segmentsByDay.map((segments, index) => {
      const items = segments.map(([postIndex, value]) => ({ ...posts[postIndex], value }));
      return {
        date: rangeDates[index],
        value: items.reduce((total, item) => total + item.value, 0),
        items,
      };
    });
  const viewTrend = buildContentTrend(viewSegments);
  const engagementTrend = buildContentTrend(engagementSegments);
  return {
    generated_at: "2026-08-20T14:20:00Z",
    last_synced_at: "2026-08-20T14:18:00Z",
    range_days: 30,
    content_total: 49,
    summary: {
      followers: { value: 6901, delta: 157, measured: 5 },
      engagement: {
        value: engagementTrend.reduce((total, point) => total + point.value, 0),
        measured: 49,
      },
      views: { value: viewTrend.reduce((total, point) => total + point.value, 0), measured: 12 },
      impressions: { value: 8437, measured: 12 },
      reach: { value: 0, measured: 0 },
      published: 15,
    },
    follower_series: followerSeries,
    trends: {
      followers: followerSeries.slice(1).map((point, index) => ({
        date: point.date,
        value: point.value - followerSeries[index].value,
        items: [
          {
            key: connectedAccounts[index % connectedAccounts.length].id,
            label: `@${connectedAccounts[index % connectedAccounts.length].account_username}`,
            platform: connectedAccounts[index % connectedAccounts.length].platform,
            value: point.value - followerSeries[index].value,
          },
        ],
      })),
      engagement: engagementTrend,
      views: viewTrend,
    },
    accounts: connectedAccounts.map((account, index) => ({
      id: account.id,
      platform: account.platform,
      username: `@${account.account_username}`,
      status: "ok",
      account_supported: true,
      content_supported: true,
      missing_account_scopes: [],
      missing_content_scopes: [],
      metrics: {
        followers: [4120, 1140, 426, 318, 777, 220][index],
        posts: 15,
      },
      follower_delta: [91, 31, 12, 8, 13, 2][index],
      follower_series: index === 0 ? followerSeries : [],
      last_synced_at: "2026-08-20T14:18:00Z",
    })),
    content: [],
    publications: [
      {
        publication_id: "analytics-publication",
        title: "The boring part of publishing should stay boring",
        excerpt: "Draft once, adapt the details, and keep the result visible.",
        published_at: "2026-08-19T12:05:00Z",
        metrics: { likes: 22, comments: 6, reposts: 5, impressions: 980 },
        measured: { likes: 1, comments: 1, reposts: 1, impressions: 1 },
        engagement: 33,
        engagement_measured: 1,
        renditions: [
          {
            publication_id: "analytics-publication",
            rendition_id: "analytics-rendition",
            title: "The boring part of publishing should stay boring",
            excerpt: "Draft once, adapt the details, and keep the result visible.",
            platform: "threads",
            account_id: "account-threads",
            username: "@rodrgds",
            external_url: "https://www.threads.net/@rodrgds/post/demo",
            published_at: "2026-08-19T12:05:00Z",
            status: "ok",
            metrics: { likes: 22, comments: 6, reposts: 5, impressions: 980 },
            engagement: 33,
            last_synced_at: "2026-08-20T14:18:00Z",
          },
        ],
      },
    ],
  };
}

async function installLocalVideoWorkspace(page: Page, sourceBase64: string): Promise<void> {
  await page.addInitScript(
    ({ source }) => {
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: async () => {
          const handle = await navigator.storage.getDirectory();
          const prototype = Object.getPrototypeOf(handle);
          if (!("queryPermission" in prototype)) {
            Object.defineProperty(prototype, "queryPermission", {
              configurable: true,
              value: async () => "granted",
            });
          }
          if (!("requestPermission" in prototype)) {
            Object.defineProperty(prototype, "requestPermission", {
              configurable: true,
              value: async () => "granted",
            });
          }
          return handle;
        },
      });
      Object.defineProperty(window, "showOpenFilePicker", {
        configurable: true,
        value: async () => {
          const bytes = Uint8Array.from(atob(source), (character) => character.charCodeAt(0));
          const file = new File([bytes], "study-sos-demo.mp4", {
            type: "video/mp4",
            lastModified: Date.parse("2026-03-04T20:29:34.000Z"),
          });
          return [
            {
              kind: "file",
              name: file.name,
              getFile: async () => file,
            },
          ];
        },
      });
    },
    { source: sourceBase64 },
  );
}

async function createVideoEditorProject(page: Page, name: string): Promise<void> {
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill(name);
  await page.getByRole("button", { name: /YouTube, 1920 × 1080/u }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
}

test.describe("product screenshot capture", () => {
  test.setTimeout(120_000);

  test.skip(
    !captureEnabled,
    "Run bun run capture:product-screenshots to update canonical product images.",
  );

  test.use({
    viewport: captureViewport,
    deviceScaleFactor: 1,
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "Europe/Lisbon",
  });

  test("captures current product surfaces with deterministic demo data", async ({
    page,
    request,
  }) => {
    await mkdir(screenshotDirectory, { recursive: true });
    const rasterFixtureBodies = new Map(
      await Promise.all(
        Object.entries(rasterFixtureFiles).map(
          async ([key, filename]) =>
            [key, await readFile(join(fixtureDirectory, filename))] as const,
        ),
      ),
    );
    const rasterFixtureBody = (key: RasterFixtureKey) => {
      const body = rasterFixtureBodies.get(key);
      if (!body) throw new Error(`Missing raster fixture ${key}`);
      return body;
    };
    // A short excerpt from https://www.youtube.com/watch?v=-m-ea3jfRpo.
    const studySOSVideo = await readFile(join(fixtureDirectory, "study-sos-demo.mp4"));

    const auth = await registerUser(request, "me@rgo.pt");
    const workspace = await createWorkspace(request, auth.token, "Personal");
    const [backgroundMediaID, logoMediaID] = await Promise.all([
      uploadImageFixture(
        request,
        auth.token,
        workspace.id,
        "lisbon-tram.png",
        rasterFixtureBody("lisbon-tram"),
      ),
      uploadImageFixture(
        request,
        auth.token,
        workspace.id,
        "logo.png",
        rasterFixtureBody("openpost-logo"),
      ),
    ]);
    imageEditorBackgroundFixture.id = backgroundMediaID;
    imageEditorLogoFixture.id = logoMediaID;
    const profile = await request.patch("/api/v1/auth/profile", {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        display_name: "Rodrigo Dias",
        avatar_url: rodrigoAvatarURL,
      },
    });
    expect(profile.ok()).toBeTruthy();
    const workspaceSettings = await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        timezone: "Europe/Lisbon",
        avatar_url: rodrigoAvatarURL,
      },
    });
    expect(workspaceSettings.ok()).toBeTruthy();

    const draftPublications = [
      publicationFixture(
        workspace.id,
        "draft-wayland",
        "draft",
        "Finally moved over to Wayland. This is what changed.",
        "2026-08-13T18:20:00Z",
        ["account-threads", "account-x"],
      ),
      publicationFixture(
        workspace.id,
        "draft-smart",
        "draft",
        "I hate it when I think I am so smart that I skip the simple fix.",
        "2026-08-06T10:15:00Z",
        ["account-mastodon"],
      ),
      publicationFixture(
        workspace.id,
        "draft-images",
        "draft",
        "Google finally built an image tool I want to keep using.",
        "2026-08-02T08:40:00Z",
        ["account-linkedin"],
      ),
    ];
    const calendarPublications = [
      publicationFixture(
        workspace.id,
        "published-aug-02",
        "published",
        "What I learned rebuilding my publishing workflow",
        "2026-08-02T09:09:00Z",
        ["account-threads", "account-linkedin", "account-bluesky"],
      ),
      publicationFixture(
        workspace.id,
        "published-aug-05",
        "published",
        "A small release with a much clearer result",
        "2026-08-05T08:57:00Z",
        ["account-x", "account-bluesky", "account-linkedin"],
      ),
      publicationFixture(
        workspace.id,
        "published-aug-07",
        "published",
        "The product work I want to repeat",
        "2026-08-07T13:04:00Z",
        ["account-threads", "account-mastodon", "account-linkedin"],
      ),
      publicationFixture(
        workspace.id,
        "published-aug-10",
        "published",
        "One source post, six useful versions",
        "2026-08-10T13:14:00Z",
        ["account-mastodon", "account-x", "account-linkedin", "account-threads"],
      ),
      publicationFixture(
        workspace.id,
        "published-aug-12-morning",
        "published",
        "Why I keep the provider limits visible",
        "2026-08-12T10:20:00Z",
        ["account-linkedin"],
      ),
      publicationFixture(
        workspace.id,
        "published-aug-12-evening",
        "published",
        "The calendar should tell the truth at a glance",
        "2026-08-12T17:02:00Z",
        ["account-linkedin", "account-threads"],
      ),
      publicationFixture(
        workspace.id,
        "published-aug-13",
        "published",
        "Moving the daily setup to Wayland",
        "2026-08-13T17:38:00Z",
        ["account-bluesky", "account-linkedin", "account-x"],
      ),
      publicationFixture(
        workspace.id,
        "published-aug-14",
        "published",
        "A cleaner way to ship release notes",
        "2026-08-14T16:09:00Z",
        ["account-linkedin", "account-bluesky", "account-mastodon"],
      ),
      publicationFixture(
        workspace.id,
        "published-aug-16",
        "published",
        "What a companies-of-one workflow needs",
        "2026-08-16T12:46:00Z",
        ["account-bluesky"],
      ),
      publicationFixture(
        workspace.id,
        "published-aug-17-morning",
        "published",
        "The boring part of publishing should stay boring",
        "2026-08-17T13:05:00Z",
        ["account-threads", "account-linkedin", "account-bluesky"],
      ),
      publicationFixture(
        workspace.id,
        "published-aug-17-evening",
        "published",
        "Good automation still leaves the result visible",
        "2026-08-17T14:58:00Z",
        ["account-bluesky", "account-mastodon", "account-linkedin"],
      ),
      publicationFixture(
        workspace.id,
        "published-aug-19",
        "published",
        "One workspace is enough when every state is clear",
        "2026-08-19T08:52:00Z",
        ["account-mastodon", "account-threads", "account-x"],
      ),
      publicationFixture(
        workspace.id,
        "scheduled-aug-21",
        "scheduled",
        "Launch notes for the next OpenPost release",
        "2026-08-21T16:00:00Z",
        ["account-mastodon", "account-x", "account-linkedin"],
      ),
      publicationFixture(
        workspace.id,
        "scheduled-aug-23",
        "scheduled",
        "Three details that made the editor calmer",
        "2026-08-23T10:00:00Z",
        ["account-bluesky", "account-mastodon", "account-x"],
      ),
      publicationFixture(
        workspace.id,
        "scheduled-aug-24",
        "scheduled",
        "A short note on product defaults",
        "2026-08-24T13:00:00Z",
        ["account-mastodon", "account-linkedin", "account-x"],
      ),
    ];

    await authenticatePage(page, auth.token);
    await page.addInitScript(() => {
      localStorage.setItem("mode-watcher-mode", "dark");
    });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.clock.setFixedTime(new Date(fixedNow));
    let editorMediaFixturesEnabled = false;
    const visibleMediaFixtures = () =>
      editorMediaFixturesEnabled ? allMediaFixtures : mediaFixtures;

    const fulfillArtworkFixture = async (route: Route, key?: string) => {
      const rasterBody = key ? rasterFixtureBodies.get(key) : undefined;
      const svgBody = key ? artwork[key as keyof typeof artwork] : undefined;
      if (!rasterBody && !svgBody) {
        await route.abort();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: rasterBody ? "image/png" : "image/svg+xml",
        headers: { "cache-control": "public, max-age=31536000, immutable" },
        body: rasterBody ?? svgBody,
      });
    };
    await page.route("**/marketing-fixtures/**", async (route) => {
      const filename = new URL(route.request().url()).pathname.split("/").at(-1);
      await fulfillArtworkFixture(route, filename?.replace(/\.(?:png|svg)$/u, ""));
    });
    await page.route("**/media/media-*", async (route) => {
      const mediaID = new URL(route.request().url()).pathname.split("/").at(-1);
      const item = allMediaFixtures.find((candidate) => candidate.id === mediaID);
      await fulfillArtworkFixture(route, item?.artwork);
    });

    await page.route("**/api/v1/accounts?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: connectedAccounts,
      });
    });
    await page.route("**/api/v1/social-sets?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: "social-set-shortform",
            workspace_id: workspace.id,
            name: "Shortform writing",
            is_default: true,
            created_at: fixedNow,
            updated_at: fixedNow,
            accounts: connectedAccounts.map((account, displayOrder) => ({
              social_account_id: account.id,
              platform: account.platform,
              account_username: account.account_username,
              account_avatar_url: account.account_avatar_url,
              display_order: displayOrder,
            })),
          },
        ],
      });
    });
    await page.route("**/api/v1/accounts/providers*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: providerFixtures,
      });
    });
    await page.route("**/api/v1/provider-readiness**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          providers: connectedAccounts.map((account) => ({
            provider: account.platform,
            configured_app_state: "ready",
            connected_accounts: 1,
            blocking_issues: [],
            next_actions: [],
          })),
        },
      });
    });
    await page.route("**/api/v1/capabilities/resolve", async (route) => {
      const body = route.request().postDataJSON() as {
        account_ids?: string[];
        intent?: string;
      };
      const accounts = (body.account_ids ?? [])
        .map((accountID) => connectedAccounts.find((account) => account.id === accountID))
        .filter((account): account is (typeof connectedAccounts)[number] => Boolean(account))
        .map((account) => ({
          account_id: account.id,
          active_constraints: {},
          capability_revision: "product-screenshot-v1",
          compatible: true,
          intents: ["post", "thread"],
          issues: [],
          label:
            providerFixtures.find((provider) => provider.platform === account.platform)
              ?.display_name ?? account.platform,
          media: {
            allowed_mimes: ["image/jpeg", "image/png", "video/mp4"],
            max_count: 4,
            min_count: 0,
            requires_https_fetchable: false,
            requires_public_url: false,
          },
          media_shapes: ["landscape", "portrait", "square"],
          native_scheduling: false,
          openpost_queued: true,
          output_profile: account.platform,
          profile: account.platform,
          provider: account.platform,
          requires_app_review: false,
          requires_public_media: false,
          immediate_readiness: { state: "healthy", publishable: true },
          scheduled_readiness: { state: "healthy", publishable: true },
          setting_groups: [],
          text_limit: account.platform === "x" ? 280 : 3_000,
        }));
      await route.fulfill({
        contentType: "application/json",
        json: { accounts },
      });
    });
    await page.route("**/api/v1/media?**", async (route) => {
      const fixtures = visibleMediaFixtures();
      await route.fulfill({
        contentType: "application/json",
        json: {
          total: fixtures.length,
          limit: 40,
          offset: 0,
          media: fixtures.map((item, index) => ({
            id: item.id,
            workspace_id: workspace.id,
            mime_type: "image/png",
            size: item.size,
            original_filename: item.filename,
            width: item.width,
            height: item.height,
            alt_text: `${item.filename.replace(/\.png$/, "")} marketing artwork`,
            is_favorite: item.favorite,
            created_at: new Date(Date.parse(fixedNow) - index * 86_400_000).toISOString(),
            url: mediaFixtureURL(item.artwork),
            thumbnail_url: mediaFixtureURL(item.artwork),
            usage_count: item.usage,
            can_delete: item.canDelete,
            processing_status: "ready",
            processing_progress: 100,
            analysis_status: "complete",
            duration_ms: 0,
            frame_rate: 0,
            source: "upload",
            asset_kind: "image",
            tags: [],
          })),
        },
      });
    });
    await page.route("**/api/v1/media/storage?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          used_bytes: 31_247_565,
          asset_count: visibleMediaFixtures().length,
          internal_bytes: 0,
          limit_bytes: 0,
        },
      });
    });
    await page.route("**/api/v1/publications?**", async (route) => {
      const requestURL = new URL(route.request().url());
      const publications =
        requestURL.searchParams.get("status") === "draft"
          ? draftPublications
          : calendarPublications;
      await route.fulfill({
        contentType: "application/json",
        headers: { "X-Has-More": "false" },
        json: publications,
      });
    });
    await page.route("**/api/v1/posts/schedule-overview?**", async (route) => {
      const month = new URL(route.request().url()).searchParams.get("month") ?? "";
      const dayCounts = new Map<string, number>();
      if (month === "2026-08") {
        for (const publication of calendarPublications) {
          const date = (publication.actual_run_at || publication.scheduled_at).slice(0, 10);
          dayCounts.set(date, (dayCounts.get(date) ?? 0) + 1);
        }
      }
      await route.fulfill({
        contentType: "application/json",
        json: {
          month,
          selected_workspace_id: workspace.id,
          days: [...dayCounts].map(([date, count]) => ({ date, count })),
          platforms: [],
          workspaces: [],
        },
      });
    });
    await page.route("**/api/v1/analytics**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: analyticsFixture(),
      });
    });
    await page.route(`**/api/v1/workspaces/${workspace.id}/setup`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          activated: true,
          visible: false,
          completed_steps: 4,
          total_steps: 4,
          steps: [
            { id: "workspace", completed: true },
            { id: "destination", completed: true },
            { id: "composition", completed: true },
            { id: "publication", completed: true },
          ],
        },
      });
    });
    let publicationRevision = 0;
    let publicationState: Record<string, unknown> = {};
    await page.route("**/api/v1/publications", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      publicationRevision += 1;
      publicationState = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: "application/json",
        json: {
          ...publicationState,
          id: "screenshot-publication",
          workspace_id: workspace.id,
          revision: publicationRevision,
          status: "draft",
          renditions: publicationState.renditions ?? [],
        },
      });
    });
    await page.route("**/api/v1/publications/screenshot-publication", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      publicationRevision += 1;
      publicationState = {
        ...publicationState,
        ...(route.request().postDataJSON() as Record<string, unknown>),
      };
      await route.fulfill({
        contentType: "application/json",
        json: {
          ...publicationState,
          id: "screenshot-publication",
          workspace_id: workspace.id,
          revision: publicationRevision,
          status: "draft",
          renditions: publicationState.renditions ?? [],
        },
      });
    });

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/");
    await expect(page.getByTestId("compose-shell")).toBeVisible();
    await expect(page.getByTestId("composer-account-loading")).toHaveCount(0);
    await expect(
      page.getByTestId("composer-account-control").getByTestId("composer-account-icon"),
    ).toHaveCount(3);
    await expect(page.getByTestId("composer-account-control")).toContainText("+3");
    await page
      .locator("#post-textarea-0")
      .fill(
        "Approval prompts FEEL safe because they ask a human.\n\nBut the human is usually tired and doesn't want to read a huge confusing bash command.\n\nWelp...",
      );
    const composer = page.getByTestId("text-thread-composer-content");
    await composer.getByRole("button", { name: "Add media" }).click();
    const mediaPicker = page.getByRole("dialog");
    await mediaPicker.getByRole("tab", { name: "Library" }).click();
    await mediaPicker.getByRole("button", { name: "Select command-review.png" }).click();
    await mediaPicker.getByRole("button", { name: "Add media", exact: true }).click();
    await expect(composer.getByRole("button", { name: "Remove media" })).toBeVisible();
    await expect(page.getByTestId("composer-primary-delivery-action")).toBeVisible();
    await capture(page, "main-dark.png", [
      page.getByTestId("desktop-composer-controls"),
      composer.getByRole("button", { name: "Remove media" }),
    ]);

    await page.goto(`/calendar?workspace=${workspace.id}`);
    await expect(page.getByRole("heading", { name: "August 2026" })).toBeVisible();
    await expect(page.locator("[data-calendar-item]")).toHaveCount(calendarPublications.length);
    await capture(page, "calendar-dark.png", [
      page.getByRole("region", { name: "Monthly publishing calendar" }),
      page.getByRole("button", {
        name: /Launch notes for the next OpenPost release/u,
      }),
    ]);

    await page.goto(`/analytics?workspace=${workspace.id}`);
    await expect(page.getByRole("heading", { name: "Analytics", level: 1 })).toBeVisible();
    await expect(page.getByText("6.9K", { exact: true }).first()).toBeVisible();
    const dailyViewsChart = page.getByRole("img", { name: "Daily views" });
    await expect(dailyViewsChart).toBeVisible();
    await expect
      .poll(() =>
        page.getByTestId("analytics-chart-scroll").evaluate((viewport) => {
          const canvas = viewport.firstElementChild;
          if (!(canvas instanceof HTMLElement) || viewport.clientWidth === 0) return 0;
          return canvas.getBoundingClientRect().width / viewport.clientWidth;
        }),
      )
      .toBeGreaterThanOrEqual(0.99);
    await capture(page, "analytics-dark.png", [
      page.getByRole("heading", { name: "Highlights" }),
      dailyViewsChart,
    ]);

    await page.goto("/settings?tab=accounts");
    await expect(page.getByRole("heading", { name: "Connected channels" })).toBeVisible();
    await expect(page.getByText("@rodrgds").first()).toBeVisible();
    await expect(page.getByTestId("provider-card-bluesky")).toBeVisible();
    await capture(page, "accounts-dark.png", [
      page.getByRole("heading", { name: "Connected channels" }),
      page.getByTestId("provider-card-youtube"),
    ]);

    await page.goto("/media");
    await expect(page.getByRole("heading", { name: "Media", level: 1 })).toBeVisible();
    await expect(page.getByText("command-review.png")).toBeVisible();
    await page.waitForFunction(() =>
      Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
    );
    await capture(page, "media-dark.png", [
      page.getByRole("heading", { name: "Media", level: 1 }),
      page.getByText("media-library.png"),
    ]);

    await page.evaluate(() => {
      localStorage.setItem("openpost-image-editor-first-edit-v1", "1");
    });
    editorMediaFixturesEnabled = true;
    await page.goto(`/image-editor/new?workspace=${workspace.id}`);
    await page.getByRole("spinbutton", { name: "Width" }).fill("1500");
    await page.getByRole("spinbutton", { name: "Height" }).fill("500");
    await page.getByRole("button", { name: "Create custom design" }).click();
    await expect(page).toHaveURL(/\/image-editor\/[0-9a-f-]+$/u);
    const imageEditorStage = page.getByTestId("image-editor-stage");
    await expect(imageEditorStage).toBeVisible();
    await page.getByRole("textbox", { name: "Design title" }).fill("X Banner");
    const imageProperties = page.locator(".image-editor-inspector");
    await imageProperties.getByRole("button", { name: "Image", exact: true }).click();
    await page.getByRole("button", { name: /lisbon-tram\.png/u }).click();
    await imageProperties.getByRole("button", { name: "Fit" }).click();
    await page.getByRole("option", { name: "Stretch", exact: true }).click();
    await page.getByRole("button", { name: /logo\.png/u }).click();
    const logoLayer = page.getByRole("treeitem", { name: /logo\.png, image/u });
    await expect(logoLayer).toHaveAttribute("aria-selected", "true");
    await imageProperties.getByRole("button", { name: "Transform", exact: true }).click();
    await imageProperties.getByRole("spinbutton", { name: "W", exact: true }).fill("147");
    await imageProperties.getByRole("spinbutton", { name: "W", exact: true }).press("Tab");
    await imageProperties.getByRole("button", { name: "Center X" }).click();
    await imageProperties.getByRole("button", { name: "Center Y" }).click();
    await expect(imageProperties.getByRole("spinbutton", { name: "W", exact: true })).toHaveValue(
      "147",
    );
    await expect(imageProperties.getByRole("spinbutton", { name: "H", exact: true })).toHaveValue(
      "147",
    );
    await imageProperties.getByRole("button", { name: "Transform", exact: true }).click();
    const adjustmentsButton = imageProperties.getByRole("button", {
      name: "Adjustments",
      exact: true,
    });
    await adjustmentsButton.click();
    const brightnessSlider = imageProperties.getByRole("slider", { name: "Brightness" });
    await brightnessSlider.press("End");
    await expect(brightnessSlider).toHaveAttribute("aria-valuenow", "1");
    await brightnessSlider.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("image-editor-save-indicator")).toHaveAttribute(
      "data-state",
      "saved",
      { timeout: 15_000 },
    );
    await capture(page, "image-editor-dark.png", [
      imageEditorStage,
      logoLayer,
      adjustmentsButton,
      brightnessSlider,
    ]);

    await installLocalVideoWorkspace(page, studySOSVideo.toString("base64"));
    await createVideoEditorProject(page, "Study SOS cut");
    await page.getByRole("button", { name: "Import media" }).click();
    const placeStudySOS = page.getByRole("button", {
      name: /Place on timeline: study-sos-demo\.mp4/u,
    });
    await expect(placeStudySOS).toBeVisible({ timeout: 30_000 });
    await placeStudySOS.click();
    await expect(page.locator("[data-media-placement-status]")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const timelineItems = page.locator("[data-timeline-item-id]");
    await expect(timelineItems).toHaveCount(1);
    await expect(timelineItems.first().locator("[data-filmstrip-tile]").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(timelineItems.first().locator("[data-waveform-window]")).toBeVisible({
      timeout: 15_000,
    });
    const videoInspector = page.getByRole("complementary", { name: "Edit" });
    const programMonitor = page.locator("[data-program-monitor]");
    const programVideo = programMonitor.locator("video").first();
    await expect(programMonitor).toBeVisible();
    await expect(programVideo).toBeVisible();
    await expect
      .poll(
        () =>
          programVideo.evaluate((video) => ({
            hasFrame: video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
            width: video.videoWidth,
            height: video.videoHeight,
          })),
        { timeout: 15_000 },
      )
      .toEqual({ hasFrame: true, width: 640, height: 360 });
    await programVideo.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    const propertiesTab = videoInspector.getByRole("tab", { name: "Properties" });
    await expect(propertiesTab).toHaveAttribute("aria-selected", "true");
    await capture(page, "video-editor-dark.png", [
      programMonitor,
      timelineItems.first(),
      propertiesTab,
    ]);

    await page.goto("/settings?tab=general");
    await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
    await expect(page.locator('[data-settings-tab="general"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    await capture(page, "settings-dark.png", [
      page.getByRole("heading", { name: "General", level: 1 }),
      page.getByRole("button", { name: "Save changes" }),
    ]);

    await frameReadmeHero(page);

    expect(pageErrors).toEqual([]);
  });
});

async function capture(page: Page, filename: string, landmarks: Locator[]) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForFunction(() =>
    Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
  );
  await expect(
    page.getByRole("region", { name: /Notifications/u }).getByRole("listitem"),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      })),
    )
    .toEqual({
      documentWidth: captureViewport.width,
      viewportWidth: captureViewport.width,
    });
  for (const landmark of landmarks) await expect(landmark).toBeInViewport();
  await page.screenshot({
    path: join(screenshotDirectory, filename),
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    scale: "css",
  });
}

async function frameReadmeHero(page: Page) {
  const rawScreenshot = await readFile(join(screenshotDirectory, "main-dark.png"));
  await page.setViewportSize(captureViewport);
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <style>
          html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
          body { display: grid; place-items: center; }
          img {
            display: block;
            width: 1320px;
            height: 880px;
            border: 1px solid rgba(255, 250, 244, 0.13);
            border-radius: 18px;
            box-shadow: 0 30px 58px rgba(0, 0, 0, 0.44), 0 8px 18px rgba(0, 0, 0, 0.22);
          }
        </style>
      </head>
      <body><img alt="" src="data:image/png;base64,${rawScreenshot.toString("base64")}"></body>
    </html>
  `);
  await page.screenshot({
    path: join(screenshotDirectory, "readme-hero-dark.png"),
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    omitBackground: true,
    scale: "css",
  });
}
