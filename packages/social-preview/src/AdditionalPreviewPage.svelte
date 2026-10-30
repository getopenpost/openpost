<script lang="ts">
  import Send from "@lucide/svelte/icons/send";
  import Home from "@lucide/svelte/icons/house";
  import Search from "@lucide/svelte/icons/search";
  import Plus from "@lucide/svelte/icons/plus";
  import Heart from "@lucide/svelte/icons/heart";
  import User from "@lucide/svelte/icons/user-round";
  import Menu from "@lucide/svelte/icons/menu";
  import Bell from "@lucide/svelte/icons/bell";
  import Compass from "@lucide/svelte/icons/compass";
  import Video from "@lucide/svelte/icons/video";
  import Bookmark from "@lucide/svelte/icons/bookmark";
  import MessageCircle from "@lucide/svelte/icons/message-circle";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Settings from "@lucide/svelte/icons/settings";
  import Star from "@lucide/svelte/icons/star";
  import Github from "@lucide/svelte/icons/github";
  import type { PreviewModel, PreviewScheme } from "./model";
  import { platformNames } from "./model";
  import PlatformGlyph from "./PlatformGlyph.svelte";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import SocialPreview from "./SocialPreview.svelte";

  let { model, scheme }: { model: PreviewModel; scheme: PreviewScheme } =
    $props();
  const platform = $derived(String(model.platform));
  const name = $derived(platformNames[model.platform]);
</script>

{#snippet brand()}
  <div class="brand">
    <PlatformGlyph platform={model.platform} /><strong>{name}</strong>
  </div>
{/snippet}
{#snippet search(label: string)}
  <div class="search" aria-hidden="true"><Search /><span>{label}</span></div>
{/snippet}
{#snippet bottom()}
  <div class="bottom" aria-hidden="true">
    <Home /><Search /><Plus /><Bell /><User />
  </div>
{/snippet}

<div class={["native-page", platform]}>
  {#if platform === "threads"}
    <aside class="threads-rail" aria-hidden="true">
      <header><strong>Threads</strong><Menu /></header>
      <div class="threads-primary">
        <div><Home /><strong>For you</strong></div>
        <div><Plus /><span>New thread</span></div>
        <div><Search /><span>Search</span></div>
      </div>
      <div>
        <div><MessageCircle /><span>Messages</span></div>
        <div><Heart /><span>Activity</span></div>
        <div><User /><span>Profile</span></div>
        <div><Compass /><span>Insights</span></div>
      </div>
      <small>Other feeds</small>
      <div>
        <div><User /><span>Following</span></div>
        <div><Bookmark /><span>Saved</span></div>
        <div><Heart /><span>Liked</span></div>
        <div><MessageCircle /><span>Ghost posts</span></div>
        <div><Bookmark /><span>Archive</span></div>
      </div>
    </aside>
    <div class="threads-column">
      <header class="threads-mobile-heading" aria-hidden="true">
        <Menu /><PlatformGlyph platform="threads" /><Search />
      </header>
      <div class="threads-mobile-tabs" aria-hidden="true">
        <strong>For you</strong><span>Following</span>
      </div>
      <header class="threads-heading" aria-hidden="true">
        <span>For you</span><MoreHorizontal />
      </header>
      <section class="threads-feed">
        <div class="threads-composer" aria-hidden="true">
          <PreviewAvatar identity={model.identity} size={36} /><span
            >What's new?</span
          ><b>Post</b>
        </div>
        <SocialPreview {model} {scheme} />
      </section>
    </div>
    <div class="bottom threads-bottom" aria-hidden="true">
      <Home /><Send /><Plus /><Heart /><User />
    </div>
  {:else if platform === "mastodon"}
    <div class="mastodon-layout">
      <aside class="mastodon-compose" aria-hidden="true">
        {@render brand()}{@render search("Search")}
        <div class="profile">
          <PreviewAvatar identity={model.identity} size={40} /><span
            ><strong>{model.identity.displayName}</strong><small
              >@{model.identity.handle.replace(/^@/u, "")}</small
            ></span
          >
        </div>
        <div class="compose-text">What's on your mind?</div>
        <div class="compose-tools"><Plus /><span>Publish!</span></div>
      </aside>
      <section class="mastodon-feed">
        <header class="mastodon-heading" aria-hidden="true">
          <Home /><strong>Home</strong><Menu />
        </header>
        <SocialPreview {model} {scheme} />
      </section>
      <aside class="mastodon-navigation" aria-hidden="true">
        <div class="side-row"><Home /><strong>Home</strong></div>
        <div class="side-row"><Bell /><strong>Notifications</strong></div>
        <div class="side-row"><Compass /><strong>Explore</strong></div>
        <div class="side-row"><Video /><strong>Live feeds</strong></div>
        <div class="side-row">
          <MessageCircle /><strong>Private mentions</strong>
        </div>
        <div class="side-row"><Bookmark /><strong>Bookmarks</strong></div>
        <div class="side-row"><User /><strong>Profile</strong></div>
        <hr />
        <div class="side-row"><Menu /><strong>Preferences</strong></div>
      </aside>
    </div>
    {@render bottom()}
  {:else if platform === "pixelfed"}
    <header class="topbar">
      {@render brand()}{@render search("Search")}
      <div class="top-icons" aria-hidden="true">
        <Home /><Compass /><Plus /><Bell /><User />
      </div>
    </header>
    <div class="photo-layout">
      <section class="photo-feed">
        <div class="tabs" aria-hidden="true">
          <strong>Home</strong><span>Local</span><span>Discover</span>
        </div>
        <SocialPreview {model} {scheme} />
      </section>
      <aside class="photo-sidebar" aria-hidden="true">
        <div class="profile">
          <PreviewAvatar identity={model.identity} size={44} /><span
            ><strong>{model.identity.displayName}</strong><small
              >@{model.identity.handle.replace(/^@/u, "")}</small
            ></span
          >
        </div>
        <h2>Discover</h2>
        <p>Explore photos from the community</p>
        <div class="side-row"><Compass /><strong>Explore</strong></div>
        <div class="side-row"><Bookmark /><strong>Collections</strong></div>
        <footer>About · Help · Privacy · Terms</footer>
      </aside>
    </div>
    {@render bottom()}
  {:else if platform === "peertube"}
    <header class="topbar peertube-topbar">
      {@render brand()}{@render search("Search videos")}
      <span class="publish" aria-hidden="true"><Plus />Publish</span>
    </header>
    <div class="watch-layout">
      <section class="video-main"><SocialPreview {model} {scheme} /></section>
      <aside class="other-videos" aria-hidden="true">
        <h2>Other videos</h2>
        {#each Array(4) as _, index (index)}
          <div class="video-miniature">
            <div class="miniature-thumb"><i></i></div>
            <div class="miniature-info">
              <b></b><span></span>
            </div>
          </div>
        {/each}
      </aside>
    </div>
  {:else if platform === "pinterest"}
    <header class="topbar pinterest-topbar">
      {@render brand()}<strong aria-hidden="true">Home</strong><span
        class="desktop"
        aria-hidden="true">Create</span
      >{@render search("Search")}
      <div class="top-icons" aria-hidden="true">
        <Bell /><MessageCircle /><User /><ChevronDown />
      </div>
    </header>
    <div class="pin-closeup">
      <section class="pin-detail"><SocialPreview {model} {scheme} /></section>
      <aside class="related-pins" aria-hidden="true">
        <h2>More like this</h2>
        <div class="related-grid">
          {#each [{ ratio: "3/4", wide: "70%" }, { ratio: "4/5", wide: "85%" }, { ratio: "1/1", wide: "60%" }, { ratio: "2/3", wide: "75%" }, { ratio: "4/3", wide: "55%" }, { ratio: "3/4", wide: "80%" }] as tile, index (index)}
            <div class="related-pin">
              <i style={`aspect-ratio: ${tile.ratio};`}></i>
              <span style={`width: ${tile.wide};`}></span>
              <b></b>
            </div>
          {/each}
        </div>
      </aside>
    </div>
    {@render bottom()}
  {:else if platform === "googlebusiness"}
    <header class="topbar google-topbar">
      <strong class="google-wordmark" aria-hidden="true">Google</strong
      >{@render search(model.identity.displayName)}<PreviewAvatar
        identity={model.identity}
        size={32}
      />
    </header>
    <div class="google-tabs" aria-hidden="true">
      <strong>All</strong><span>Maps</span><span>Images</span><span>Videos</span
      ><span>More</span>
    </div>
    <section class="business-layout">
      <header>
        <h2>{model.identity.displayName}</h2>
        <span class="business-label"><MapPin />Business profile</span>
      </header>
      <div class="tabs" aria-hidden="true">
        <strong>Overview</strong><span>Updates</span><span>Photos</span>
      </div>
      <h3>Updates</h3>
      <SocialPreview {model} {scheme} />
    </section>
  {:else if platform === "devnull"}
    <div class="devnull-page">
      <aside class="devnull-rail" aria-hidden="true">
        <div class="devnull-logo">
          <PlatformGlyph platform="devnull" /><strong>/dev/null</strong>
        </div>
        <nav class="devnull-nav">
          <div class="active"><Home /><span>Log</span></div>
          <div><Bell /><span>Notifications</span></div>
          <div><User /><span>Profile</span></div>
          <div><Star /><span>Starred</span></div>
          <div><Settings /><span>Settings</span></div>
        </nav>
        <div class="devnull-rail-tools">
          <div><Search /><span>Search</span></div>
          <div class="commit"><Plus /><span>Commit</span></div>
          <div class="signin"><Github /><span>Sign in with GitHub</span></div>
        </div>
      </aside>
      <section class="devnull-feed">
        <header class="devnull-mobile-header" aria-hidden="true">
          <div class="devnull-logo">
            <PlatformGlyph platform="devnull" /><strong>/dev/null</strong>
          </div>
          <span class="signin compact-signin"><Github /><span>Sign in</span></span>
        </header>
        <div class="devnull-tabs" aria-hidden="true">
          <span>Following</span><strong>Latest</strong><span>Trending</span>
        </div>
        <SocialPreview {model} {scheme} />
        {#each [1, 2] as index (index)}
          <div class="devnull-ghost" aria-hidden="true">
            <i></i>
            <span><b></b><b></b></span>
          </div>
        {/each}
      </section>
      <aside class="devnull-aside" aria-hidden="true">
        <div class="devnull-cta">
          <h2>New to /dev/null?</h2>
          <p>
            12,000+ developers are already here. Sign in with GitHub to follow
            them, star commits, and join the conversation.
          </p>
          <span class="signin"><Github /><span>Sign in with GitHub</span></span>
        </div>
        <footer>About · Apps · Terms · Privacy · Changelog</footer>
      </aside>
      {@render bottom()}
    </div>
  {:else}
    <header class="topbar forum-topbar">
      {@render brand()}{#if platform === "reddit"}{@render search(
          "Search Reddit",
        )}{:else}<div class="forum-links" aria-hidden="true">
          <strong>Communities</strong><span>Posts</span>
        </div>
        {@render search("Search")}{/if}
      <div class="top-icons" aria-hidden="true"><Plus /><Bell /><User /></div>
    </header>
    <div class="forum-layout">
      {#if platform === "reddit"}
        <aside class="forum-nav" aria-hidden="true">
          <div class="side-row"><Home /><strong>Home</strong></div>
          <div class="side-row"><Compass /><strong>Popular</strong></div>
          <hr />
          <small>EXPLORE</small>
          <div class="side-row"><Compass /><strong>All</strong></div>
          <div class="side-row">
            <Plus /><strong>Create a community</strong>
          </div>
        </aside>
      {/if}
      <section class="forum-feed">
        <div class="tabs" aria-hidden="true">
          <strong>{platform === "reddit" ? "Best" : "Subscribed"}</strong><span
            >{platform === "reddit" ? "Hot" : "Local"}</span
          ><span>{platform === "reddit" ? "New" : "All"}</span><ChevronDown />
        </div>
        {#if platform !== "reddit"}<div class="sort" aria-hidden="true">
            <strong>{platform === "piefed" ? "Hot" : "Active"}</strong><span
              >New</span
            ><span>Top</span><ChevronDown />
          </div>{/if}
        <SocialPreview {model} {scheme} />
      </section>
      <aside class="community-sidebar" aria-hidden="true">
        <h2>{model.subtitle || "Community"}</h2>
        <p>
          {platform === "reddit"
            ? "Community information"
            : `A community on ${name}`}
        </p>
        <div class="community-action">
          {platform === "reddit" ? "Create Post" : "Create post"}
        </div>
        <hr />
        <h3>About this community</h3>
        <footer>
          {platform === "reddit"
            ? "Reddit Rules · Privacy Policy · User Agreement"
            : "Communities · About · Instances"}
        </footer>
      </aside>
    </div>
    {#if platform === "reddit"}{@render bottom()}{/if}
  {/if}
</div>

<style>
  .native-page {
    --native-bg: light-dark(#fff, #101010);
    --native-panel: light-dark(#fff, #181818);
    --native-text: light-dark(#141414, #f3f3f3);
    --native-muted: light-dark(#656565, #aaa);
    --native-border: light-dark(#e4e4e4, #333);
    --native-soft: light-dark(#f3f3f3, #232323);
    min-height: 100dvh;
    background: var(--native-bg);
    color: var(--native-text);
    font:
      14px/1.5 Arial,
      Helvetica,
      sans-serif;
  }
  .native-page :global(*) {
    box-sizing: border-box;
  }
  .native-page :global(svg) {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
  }
  .native-page h2,
  .native-page h3,
  .native-page p {
    margin: 0;
  }
  .native-page h2 {
    font-size: 17px;
  }
  .native-page h3 {
    font-size: 14px;
  }
  .native-page hr {
    margin: 18px 0;
    border: 0;
    border-top: 1px solid var(--native-border);
  }
  .native-page footer {
    margin-top: 28px;
    color: var(--native-muted);
    font-size: 12px;
  }
  .topbar {
    min-height: 64px;
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 12px 28px;
    border-bottom: 1px solid var(--native-border);
    background: var(--native-panel);
  }
  .brand {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 22px;
    white-space: nowrap;
  }
  .brand :global(svg) {
    width: 30px;
    height: 30px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
    max-width: 600px;
    border-radius: 24px;
    background: var(--native-soft);
    color: var(--native-muted);
    min-height: 42px;
    padding: 0 18px;
  }
  .search span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .search :global(svg) {
    width: 19px;
    height: 19px;
  }
  .top-icons {
    display: flex;
    gap: 24px;
    align-items: center;
    margin-left: auto;
  }
  .bottom {
    display: none;
  }
  .side-row {
    display: flex;
    gap: 14px;
    align-items: center;
    padding: 12px 10px;
  }
  .side-row strong {
    font-weight: 500;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 28px;
    min-height: 56px;
    padding: 0 20px;
    border-bottom: 1px solid var(--native-border);
    color: var(--native-muted);
  }
  .tabs strong {
    color: var(--native-text);
  }
  .tabs :global(svg) {
    width: 16px;
  }
  .threads {
    --native-bg: light-dark(#fafafa, #101010);
    display: grid;
    grid-template-columns: 230px minmax(0, 1fr);
  }
  .threads-rail {
    padding: 28px 16px;
    font-size: 15px;
  }
  .threads-rail header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 12px 30px;
  }
  .threads-rail header strong {
    font-size: 25px;
  }
  .threads-rail > div {
    display: grid;
    margin-bottom: 24px;
  }
  .threads-rail > div > div {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 48px;
    padding: 10px 14px;
  }
  .threads-rail > div > div :global(svg) {
    width: 22px;
    height: 22px;
  }
  .threads-primary > div:first-child {
    background: var(--native-soft);
    border-radius: 26px;
  }
  .threads-rail small {
    display: block;
    color: var(--native-muted);
    padding: 0 14px 12px;
  }
  .threads-column {
    width: min(100%, 640px);
    justify-self: center;
    margin-right: 76px;
  }
  .threads-mobile-heading,
  .threads-mobile-tabs {
    display: none;
  }
  .threads-heading {
    min-height: 64px;
    display: flex;
    gap: 10px;
    justify-content: space-between;
    align-items: center;
    padding: 0 24px;
    font-weight: 600;
  }
  .threads-heading :global(svg) {
    width: 20px;
    border: 1px solid var(--native-border);
    border-radius: 50%;
    padding: 2px;
  }
  .threads-feed {
    min-height: calc(100dvh - 64px);
    border: 1px solid var(--native-border);
    border-bottom: 0;
    border-radius: 24px 24px 0 0;
    overflow: hidden;
    background: var(--native-panel);
  }
  .threads-composer {
    min-height: 86px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 20px 24px;
    border-bottom: 1px solid var(--native-border);
  }
  .threads-composer span {
    flex: 1;
    color: var(--native-muted);
  }
  .threads-composer b {
    padding: 5px 15px;
    border: 1px solid var(--native-border);
    border-radius: 10px;
  }
  .threads-feed :global(.social-preview),
  .forum-feed :global(.social-preview) {
    width: 100%;
  }
  .threads-feed :global(.thread-preview),
  .threads-feed :global(.microblog-preview) {
    border: 0;
    border-radius: 0;
    max-width: none;
  }
  .pixelfed {
    --native-bg: light-dark(#fafafa, #121212);
  }
  .pixelfed .topbar {
    justify-content: center;
    gap: 64px;
  }
  .pixelfed .search {
    max-width: 260px;
    min-height: 34px;
    border-radius: 6px;
  }
  .pixelfed .top-icons {
    margin: 0;
  }
  .photo-layout {
    display: grid;
    grid-template-columns: minmax(0, 600px) 280px;
    justify-content: center;
    gap: 40px;
    padding: 28px 20px;
  }
  .photo-feed {
    min-width: 0;
  }
  .photo-feed .tabs {
    margin-bottom: 18px;
    background: var(--native-panel);
    border: 1px solid var(--native-border);
    border-radius: 4px;
  }
  .photo-sidebar {
    padding-top: 12px;
  }
  .profile {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 32px;
  }
  .profile span {
    min-width: 0;
    display: grid;
  }
  .profile strong {
    overflow-wrap: anywhere;
  }
  .profile small,
  .photo-sidebar p {
    color: var(--native-muted);
  }
  .photo-sidebar p {
    margin: 10px 0;
  }
  .peertube .brand {
    color: #e96b00;
  }
  .publish {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #f1680d;
    color: #fff;
    border-radius: 4px;
    padding: 8px 16px;
    font-weight: 600;
  }
  .watch-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 40px;
    max-width: 1400px;
    margin: auto;
    padding: 32px 28px;
  }
  .video-main {
    min-width: 0;
  }
  .video-main :global(.social-preview) {
    max-width: 1100px;
    margin-inline: auto;
  }
  .other-videos h2 {
    margin-bottom: 18px;
    font-size: 16px;
  }
  .video-miniature {
    display: grid;
    gap: 12px;
    margin-bottom: 24px;
  }
  .miniature-thumb i {
    display: block;
    aspect-ratio: 16 / 9;
    border-radius: 4px;
    background: var(--native-soft);
  }
  .miniature-info b,
  .miniature-info span {
    display: block;
    border-radius: 999px;
    background: var(--native-soft);
  }
  .miniature-info b {
    width: 92%;
    height: 11px;
    margin-bottom: 8px;
  }
  .miniature-info span {
    width: 55%;
    height: 9px;
  }
  @container social-page (min-width: 68rem) {
    .watch-layout {
      grid-template-columns: minmax(0, 1fr) 340px;
    }
  }
  .pinterest .brand {
    color: light-dark(#bd081b, #ff8a99);
  }
  .pinterest-topbar {
    gap: 28px;
    border: 0;
    min-height: 88px;
  }
  .pinterest-topbar .search {
    max-width: none;
    min-height: 48px;
  }
  .pin-closeup {
    display: grid;
    gap: 24px;
    max-width: 1080px;
    margin: 32px auto;
    padding: 0 24px;
  }
  .pin-closeup .pin-detail {
    max-width: none;
    margin: 0;
    padding: 0;
  }
  .related-pins h2 {
    margin-bottom: 14px;
    font-size: 16px;
  }
  .related-grid {
    columns: 2;
    column-gap: 16px;
  }
  .related-pin {
    display: grid;
    gap: 10px;
    margin-bottom: 16px;
    padding: 12px;
    border-radius: 20px;
    background: var(--native-panel);
    break-inside: avoid;
  }
  .related-pin i {
    display: block;
    border-radius: 14px;
    background: var(--native-soft);
  }
  .related-pin span,
  .related-pin b {
    display: block;
    height: 10px;
    border-radius: 999px;
    background: var(--native-soft);
  }
  .related-pin b {
    width: 40%;
  }
  @container social-page (min-width: 68rem) {
    .pin-closeup {
      grid-template-columns: minmax(0, 48rem) minmax(0, 1fr);
      align-items: start;
    }
  }
  .reddit {
    --native-bg: light-dark(#fff, #0e1113);
    --native-panel: light-dark(#f6f7f8, #181c1f);
    --native-text: light-dark(#0f1a1c, #eef1f3);
    --native-border: light-dark(#e2e7e9, #303537);
    --native-soft: light-dark(#e5ebee, #2a3236);
  }
  .reddit .brand {
    color: light-dark(#d93900, #ff6a33);
  }
  .reddit .forum-layout {
    grid-template-columns: 220px minmax(0, 740px) 300px;
    gap: 24px;
    max-width: 1360px;
  }
  .forum-topbar {
    min-height: 58px;
  }
  .forum-links {
    display: flex;
    gap: 24px;
  }
  .forum-layout {
    display: grid;
    grid-template-columns: minmax(0, 800px) 300px;
    gap: 32px;
    max-width: 1160px;
    margin: auto;
    padding: 24px 20px;
  }
  .forum-nav {
    border-right: 1px solid var(--native-border);
    padding-right: 20px;
  }
  .forum-nav small {
    color: var(--native-muted);
  }
  .forum-feed {
    min-width: 0;
  }
  .sort {
    display: flex;
    gap: 20px;
    align-items: center;
    padding: 16px 20px;
    color: var(--native-muted);
  }
  .sort :global(svg) {
    width: 16px;
  }
  .community-sidebar {
    align-self: start;
    background: var(--native-panel);
    border: 1px solid var(--native-border);
    border-radius: 8px;
    padding: 20px;
  }
  .community-sidebar p {
    margin-top: 8px;
    color: var(--native-muted);
  }
  .community-action {
    padding: 8px;
    text-align: center;
    border: 1px solid var(--native-border);
    border-radius: 20px;
    margin-top: 20px;
  }
  .lemmy {
    --native-bg: light-dark(#fff, #222);
    --native-panel: light-dark(#f8f9fa, #303030);
  }
  .lemmy .topbar {
    background: light-dark(#f8f9fa, #303030);
  }
  .piefed .topbar {
    border-top: 4px solid #298062;
  }
  .googlebusiness {
    --native-bg: light-dark(#fff, #202124);
    --native-panel: light-dark(#fff, #303134);
    --native-text: light-dark(#202124, #e8eaed);
    --native-muted: light-dark(#5f6368, #bdc1c6);
  }
  /* /dev/null (dev-null.sh): shell background, a bordered log column, an icon
     rail, and the GitHub sign-in aside, from the site's DESIGN.md tokens. */
  .devnull-page {
    --devnull-shell: light-dark(#f6f7f8, #111112);
    --devnull-surface: light-dark(#fff, #18181a);
    --devnull-ink: light-dark(#121417, #ececec);
    --devnull-muted: light-dark(#5b616b, #a1a1a6);
    --devnull-hairline: light-dark(#e1e4e8, #2a2a2d);
    --devnull-primary: light-dark(#3b6fe0, #7aa2f7);
    --native-bg: var(--devnull-shell);
    --native-panel: var(--devnull-surface);
    --native-text: var(--devnull-ink);
    --native-muted: var(--devnull-muted);
    display: grid;
    grid-template-columns: minmax(0, 40rem);
    justify-content: center;
    min-height: 100dvh;
    background: var(--devnull-shell);
    color: var(--devnull-ink);
    font-family: "Geist", ui-sans-serif, system-ui, sans-serif;
  }
  .devnull-rail {
    display: none;
  }
  .devnull-feed {
    min-width: 0;
    background: var(--devnull-surface);
  }
  .devnull-feed :global(.social-preview) {
    width: 100%;
  }
  .devnull-logo {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .devnull-logo :global(svg) {
    width: 28px;
    height: 28px;
    color: var(--devnull-primary);
  }
  .devnull-mobile-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--devnull-hairline);
  }
  .devnull-tabs {
    display: flex;
    gap: 24px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--devnull-hairline);
    color: var(--devnull-muted);
    font-size: 14px;
  }
  .devnull-tabs strong {
    color: var(--devnull-ink);
    font-weight: 600;
  }
  .devnull-ghost {
    display: flex;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--devnull-hairline);
  }
  .devnull-ghost i {
    width: 40px;
    height: 40px;
    flex: none;
    border-radius: 999px;
    background: var(--devnull-shell);
  }
  .devnull-ghost span {
    display: grid;
    gap: 8px;
    padding-top: 4px;
  }
  .devnull-ghost b {
    display: block;
    border-radius: 999px;
    background: var(--devnull-shell);
  }
  .devnull-ghost b:first-child {
    width: 38%;
    height: 10px;
  }
  .devnull-ghost b:last-child {
    width: 72%;
    height: 10px;
  }
  .signin {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 8px;
    background: light-dark(#121417, #ececec);
    color: light-dark(#fff, #111112);
    padding: 8px 14px;
    font-size: 13.5px;
    font-weight: 600;
  }
  .signin :global(svg) {
    width: 16px;
    height: 16px;
  }
  .compact-signin {
    padding: 7px 12px;
  }
  .devnull-aside {
    display: none;
  }
  @container social-page (min-width: 52rem) {
    .devnull-page {
      grid-template-columns: 5rem minmax(0, 40rem);
    }
    .devnull-rail {
      position: sticky;
      top: 0;
      display: flex;
      height: 100dvh;
      flex-direction: column;
      gap: 20px;
      padding: 20px 10px;
    }
    .devnull-rail nav,
    .devnull-rail-tools {
      display: grid;
      gap: 4px;
    }
    .devnull-rail nav > div,
    .devnull-rail-tools > div {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      border-radius: 10px;
      color: var(--devnull-muted);
      padding: 10px 0;
      font-size: 14.5px;
    }
    .devnull-rail nav > div.active {
      background: var(--devnull-shell);
      color: var(--devnull-ink);
    }
    .devnull-rail nav > div :global(svg),
    .devnull-rail-tools > div:not(.signin) :global(svg) {
      width: 20px;
      height: 20px;
      flex: none;
    }
    .devnull-rail nav > div > span,
    .devnull-rail-tools > div > span,
    .devnull-logo > strong {
      display: none;
    }
    .devnull-rail-tools .commit {
      color: var(--devnull-ink);
      font-weight: 600;
    }
    .devnull-feed {
      border-inline: 1px solid var(--devnull-hairline);
    }
    .devnull-mobile-header {
      display: none;
    }
  }
  @container social-page (min-width: 68rem) {
    .devnull-page {
      grid-template-columns: 16rem minmax(0, 40rem) 20rem;
      justify-content: center;
      gap: 0;
    }
    .devnull-rail {
      padding: 20px 14px;
    }
    .devnull-rail nav > div,
    .devnull-rail-tools > div {
      justify-content: flex-start;
      padding: 10px;
    }
    .devnull-rail nav > div.active {
      font-weight: 600;
    }
    .devnull-rail nav > div > span,
    .devnull-rail-tools > div > span,
    .devnull-logo > strong {
      display: inline;
    }
    .devnull-rail .signin {
      justify-content: flex-start;
    }
    .devnull-aside {
      display: grid;
      align-content: start;
      gap: 28px;
      padding: 24px 20px;
    }
    .devnull-cta {
      display: grid;
      gap: 12px;
      border: 1px solid var(--devnull-hairline);
      border-radius: 14px;
      background: var(--devnull-surface);
      padding: 18px;
    }
    .devnull-cta h2 {
      font-size: 17px;
      font-weight: 600;
    }
    .devnull-cta p {
      margin: 0;
      color: var(--devnull-muted);
      font-size: 13.5px;
      line-height: 1.5;
    }
    .devnull-cta .signin {
      justify-self: start;
    }
    .devnull-aside footer {
      margin: 0;
      color: var(--devnull-muted);
      font-size: 12px;
    }
  }
  .google-wordmark {
    font-size: 28px;
    color: light-dark(#4285f4, #8ab4f8);
    font-weight: 500;
    letter-spacing: -1px;
  }
  .google-topbar {
    padding-top: 28px;
    padding-bottom: 20px;
    border: 0;
  }
  .google-topbar .search {
    border: 1px solid var(--native-border);
    background: var(--native-panel);
  }
  .google-tabs {
    display: flex;
    gap: 30px;
    padding: 12px 28px 16px 150px;
    border-bottom: 1px solid var(--native-border);
    color: var(--native-muted);
  }
  .business-layout {
    max-width: 720px;
    margin: 32px 0 0 150px;
    padding: 0 24px 40px 0;
  }
  .business-layout h2 {
    font-size: 28px;
    font-weight: 400;
    overflow-wrap: anywhere;
  }
  .business-label {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--native-muted);
    margin: 10px 0 20px;
  }
  .business-label :global(svg) {
    width: 16px;
    height: 16px;
  }
  .business-layout h3 {
    margin: 24px 0 16px;
    font-size: 20px;
    font-weight: 500;
  }
  @container social-page (max-width: 68rem) {
    .reddit .forum-layout {
      grid-template-columns: minmax(0, 740px) 280px;
    }
    .forum-nav {
      display: none;
    }
    .photo-layout {
      grid-template-columns: minmax(0, 600px);
    }
    .photo-sidebar {
      display: none;
    }
    .pinterest .brand strong {
      display: none;
    }
  }
  @container social-page (max-width: 52rem) {
    .threads {
      grid-template-columns: 76px minmax(0, 1fr);
    }
    .threads-rail {
      padding-inline: 8px;
    }
    .threads-rail header strong,
    .threads-rail span,
    .threads-rail small,
    .threads-rail > div strong {
      display: none;
    }
    .forum-layout,
    .reddit .forum-layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .community-sidebar {
      display: none;
    }
    .threads-column {
      margin-right: 20px;
    }
    .watch-layout {
      gap: 24px;
      padding: 24px 16px;
    }
    .pixelfed .topbar {
      gap: 24px;
    }
    .pixelfed .search {
      display: none;
    }
    .topbar {
      gap: 16px;
      padding-inline: 16px;
    }
    .top-icons {
      gap: 18px;
    }
    .business-layout {
      margin-left: 28px;
    }
    .google-tabs {
      padding-left: 28px;
    }
  }
  @container social-page (max-width: 40rem) {
    .threads {
      display: block;
    }
    .threads-rail {
      display: none;
    }
    .threads-column {
      width: 100%;
      margin: 0;
    }
    .threads-heading {
      display: none;
    }
    .threads-mobile-heading {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 16px;
      height: 56px;
    }
    .threads-mobile-heading :global(svg) {
      width: 24px;
      height: 24px;
    }
    .threads-mobile-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      height: 53px;
      align-items: stretch;
      border-bottom: 1px solid var(--native-border);
      text-align: center;
    }
    .threads-mobile-tabs > * {
      display: grid;
      place-items: center;
    }
    .threads-mobile-tabs strong {
      border-bottom: 2px solid var(--native-text);
    }
    .threads-mobile-tabs span {
      color: var(--native-muted);
    }
    .threads-feed {
      min-height: calc(100dvh - 165px);
    }
    .threads-feed {
      min-height: calc(100dvh - 165px);
      border: 0;
      border-radius: 0;
    }
    .threads-composer {
      display: none;
    }
    .bottom {
      display: flex;
      align-items: center;
      justify-content: space-around;
      min-height: 56px;
      position: sticky;
      bottom: 0;
      background: var(--native-panel);
      border-top: 1px solid var(--native-border);
    }
    .photo-layout {
      display: block;
      padding: 0;
    }
    .photo-feed .tabs {
      border-radius: 0;
      border-inline: 0;
      margin: 0;
    }
    .pixelfed .top-icons > :global(svg):nth-child(-n + 3) {
      display: none;
    }
    .topbar {
      min-height: 58px;
      padding: 10px 12px;
      gap: 12px;
    }
    .brand {
      font-size: 19px;
    }
    .brand :global(svg) {
      width: 27px;
      height: 27px;
    }
    .peertube .search,
    .publish,
    .forum-links,
    .desktop {
      display: none;
    }
    .watch-layout {
      padding: 12px 0;
    }
    .pin-closeup {
      margin: 0;
      padding: 0 12px;
    }
    .pinterest-topbar > strong,
    .pinterest-topbar .top-icons {
      display: none;
    }
    .pinterest-topbar .search {
      min-height: 40px;
    }
    .forum-layout,
    .reddit .forum-layout {
      padding: 0;
    }
    .forum-topbar .brand strong {
      display: none;
    }
    .forum-topbar .top-icons > :global(svg):first-child {
      display: none;
    }
    .forum-topbar .search {
      min-height: 36px;
      padding: 0 12px;
    }
    .forum-topbar .top-icons {
      gap: 12px;
    }
    .tabs {
      gap: 24px;
      padding-inline: 14px;
    }
    .google-topbar {
      flex-wrap: wrap;
    }
    .google-topbar .search {
      order: 3;
      flex-basis: 100%;
    }
    .google-topbar > :global(.preview-avatar) {
      margin-left: auto;
    }
    .google-tabs {
      gap: 22px;
      padding: 10px 12px;
    }
    .business-layout {
      margin: 20px 0 0;
      padding: 0 12px 24px;
    }
    .business-layout h2 {
      font-size: 24px;
    }
  }

  .mastodon {
    --mastodon-accent: light-dark(#705dd6, #d1c7ff);
    --native-bg: light-dark(#f9f7fc, #07060e);
    --native-panel: light-dark(#fff, #15151e);
    --native-text: light-dark(#21212c, #eeedf3);
    --native-muted: light-dark(rgb(33 33 44 / 80%), rgb(238 237 243 / 80%));
    --native-border: light-dark(rgb(112 93 214 / 20%), rgb(209 199 255 / 20%));
    --native-soft: light-dark(rgb(112 93 214 / 8%), rgb(209 199 255 / 8%));
    font-family: Inter, system-ui, -apple-system, sans-serif;
  }
  .mastodon-layout {
    display: grid;
    grid-template-columns: 285px minmax(0, 700px) 260px;
    gap: 16px;
    max-width: 1320px;
    margin: auto;
    padding: 16px;
  }
  .mastodon-compose .brand {
    color: var(--mastodon-accent);
    margin: 12px 0 28px;
  }
  .mastodon-compose .search {
    margin-bottom: 24px;
    border-radius: 4px;
  }
  .mastodon-compose .profile {
    margin-bottom: 16px;
  }
  .compose-text {
    min-height: 140px;
    background: var(--native-panel);
    color: var(--native-muted);
    border-radius: 4px 4px 0 0;
    padding: 12px;
  }
  .compose-tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--native-panel);
    padding: 10px;
  }
  .compose-tools span {
    background: var(--mastodon-accent);
    color: light-dark(#fff, #15151e);
    padding: 7px 16px;
    border-radius: 999px;
    font-weight: 600;
  }
  .mastodon-feed {
    min-width: 0;
    background: var(--native-panel);
    min-height: calc(100dvh - 32px);
  }
  .mastodon-heading {
    display: flex;
    gap: 12px;
    min-height: 56px;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid var(--native-border);
  }
  .mastodon-heading strong {
    flex: 1;
    font-size: 18px;
  }
  .mastodon-heading :global(svg) {
    width: 20px;
    height: 20px;
  }
  .mastodon-navigation {
    padding-top: 12px;
  }
  .mastodon-navigation .side-row:first-child {
    color: var(--mastodon-accent);
  }
  .mastodon-feed :global(.micro-preview.platform-mastodon) {
    border: 0;
    border-radius: 0;
    max-width: none;
    width: 100%;
  }
  .mastodon-feed :global(.social-preview) {
    padding: 0;
  }
  .mastodon-feed :global(.micro-preview.platform-mastodon) {
    background: var(--native-panel);
  }
  @container social-page (max-width: 40rem) {
    .pixelfed,
    .pinterest,
    .reddit,
    .devnull-page {
      display: flex;
      flex-direction: column;
    }
    .bottom {
      margin-top: auto;
    }
  }
  .threads-feed :global(.micro-preview.platform-threads) {
    background: var(--native-panel);
    border: 0;
    border-radius: 0;
    width: 100%;
    max-width: none;
  }
  @container social-page (max-width: 68rem) {
    .mastodon-layout {
      grid-template-columns: minmax(0, 700px) 240px;
      justify-content: center;
    }
    .mastodon-compose {
      display: none;
    }
  }
  @container social-page (max-width: 52rem) {
    .mastodon-layout {
      display: block;
      padding: 0;
    }
    .mastodon-navigation {
      display: none;
    }
    .mastodon-feed {
      min-height: calc(100dvh - 56px);
    }
  }
  @container social-page (min-width: 68rem) {
    .threads-column {
      margin-right: 226px;
    }
  }
</style>
