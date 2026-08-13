<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    Check,
    ClipboardCopy,
    ExternalLink,
    Globe2,
    LoaderCircle,
    SearchCheck,
  } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import {
    copyToClipboard,
    parseSocialHandle,
  } from "../../tools/_lib/tool-utils";

  type LiveResult =
    | { status: "idle"; message: string }
    | { status: "loading"; message: string }
    | {
        status: "found";
        message: string;
        identity?: string;
        profileUrl?: string;
      }
    | { status: "not-found"; message: string };

  let handle = $state("@alice@mastodon.social");
  let live = $state<LiveResult>({
    status: "idle",
    message: "No network request has been made.",
  });
  let copied = $state(false);
  let activeController: AbortController | undefined;
  let liveRequestVersion = 0;
  const parsed = $derived(parseSocialHandle(handle));
  const resultProfileUrl = $derived(
    live.status === "found"
      ? (live.profileUrl ?? parsed.profileUrl)
      : parsed.profileUrl,
  );
  const resultProfileLabel = $derived(
    live.status === "found"
      ? "Open resolved profile"
      : parsed.type === "mastodon"
        ? "Open common profile URL"
        : "Open Bluesky profile",
  );

  function safeHttpsUrl(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : undefined;
    } catch {
      return undefined;
    }
  }

  function webfingerLink(
    links: unknown[],
    relation: string,
  ): string | undefined {
    for (const link of links) {
      if (
        typeof link === "object" &&
        link !== null &&
        "rel" in link &&
        link.rel === relation &&
        "href" in link
      ) {
        const href = safeHttpsUrl(link.href);
        if (href) return href;
      }
    }
    return undefined;
  }

  function updateHandle(value: string) {
    liveRequestVersion += 1;
    activeController?.abort();
    activeController = undefined;
    handle = value;
    live = { status: "idle", message: "No network request has been made." };
  }

  async function checkLive() {
    const request = parsed;
    if (!request.valid || !request.lookupUrl) return;
    const requestVersion = ++liveRequestVersion;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    let timedOut = false;
    live = { status: "loading", message: `Checking ${request.host}…` };
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 8000);

    try {
      const response = await fetch(request.lookupUrl, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Lookup failed");
      const data: unknown = await response.json();
      if (requestVersion !== liveRequestVersion) return;

      if (request.type === "bluesky") {
        const did =
          typeof data === "object" &&
          data !== null &&
          "did" in data &&
          typeof data.did === "string"
            ? data.did
            : "";
        if (!did.startsWith("did:"))
          throw new Error("Invalid Bluesky response");
        live = {
          status: "found",
          message: "Bluesky resolved this handle.",
          identity: did,
          profileUrl: request.profileUrl,
        };
        return;
      }

      const subject =
        typeof data === "object" &&
        data !== null &&
        "subject" in data &&
        typeof data.subject === "string"
          ? data.subject
          : "";
      const links =
        typeof data === "object" &&
        data !== null &&
        "links" in data &&
        Array.isArray(data.links)
          ? data.links
          : [];
      const aliases =
        typeof data === "object" &&
        data !== null &&
        "aliases" in data &&
        Array.isArray(data.aliases)
          ? data.aliases
          : [];
      const actorUrl = webfingerLink(links, "self");
      const profileUrl =
        webfingerLink(links, "http://webfinger.net/rel/profile-page") ??
        aliases.map(safeHttpsUrl).find(Boolean) ??
        request.profileUrl;
      const expectedSubject =
        `acct:${request.username}@${request.host}`.toLowerCase();
      if (subject.toLowerCase() !== expectedSubject || !actorUrl) {
        throw new Error("Invalid WebFinger response");
      }
      if (requestVersion !== liveRequestVersion) return;
      live = {
        status: "found",
        message: "The server found this account.",
        identity: actorUrl,
        profileUrl,
      };
    } catch {
      if (requestVersion !== liveRequestVersion) return;
      live = {
        status: "not-found",
        message: timedOut
          ? "The server did not respond within eight seconds."
          : "The account was not found, or its server does not allow this browser lookup.",
      };
    } finally {
      window.clearTimeout(timeout);
      if (activeController === controller) activeController = undefined;
    }
  }

  async function copyNormalized() {
    if (!parsed.valid) return;
    try {
      await copyToClipboard(parsed.normalized);
      copied = true;
      window.setTimeout(() => (copied = false), 2000);
    } catch {
      copied = false;
    }
  }

  onDestroy(() => {
    liveRequestVersion += 1;
    activeController?.abort();
  });
</script>

<div class="mt-8 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(22rem,1.1fr)]">
  <section
    class="rounded-lg border bg-card p-4 sm:p-6"
    aria-labelledby="handle-input-title"
  >
    <div
      class="flex size-10 items-center justify-center rounded-xl border bg-background text-primary"
    >
      <Globe2 class="size-5" />
    </div>
    <h2 id="handle-input-title" class="mt-4 text-lg font-semibold">
      Check a social handle
    </h2>
    <p class="mt-1 text-sm leading-6 text-muted-foreground">
      Validate the format first. A live request only runs after you choose to
      check it.
    </p>

    <label for="social-handle" class="mt-6 block text-sm font-medium"
      >Fediverse or Bluesky handle</label
    >
    <Input
      id="social-handle"
      value={handle}
      oninput={(event) => updateHandle(event.currentTarget.value)}
      class="mt-2 h-12 px-4 font-mono"
      placeholder="@name@server.example or name.bsky.social"
      autocapitalize="none"
      autocomplete="off"
      spellcheck="false"
    />

    <div class="mt-4 rounded-xl border bg-muted/20 p-4">
      <div class="flex items-start gap-3">
        <div
          class={[
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
            parsed.valid
              ? "bg-primary/10 text-primary"
              : "bg-destructive/10 text-destructive",
          ]}
        >
          {#if parsed.valid}<Check class="size-4" />{:else}<span
              aria-hidden="true">!</span
            >{/if}
        </div>
        <div class="min-w-0">
          <p class="font-medium">{parsed.label}</p>
          <p class="mt-1 text-sm leading-6 text-muted-foreground">
            {parsed.message}
          </p>
          {#if parsed.valid}
            <p class="mt-2 break-all font-mono text-sm">{parsed.normalized}</p>
          {/if}
        </div>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap gap-2">
      <Button
        type="button"
        disabled={!parsed.valid || live.status === "loading"}
        onclick={checkLive}
      >
        {#if live.status === "loading"}
          <LoaderCircle data-icon="inline-start" class="animate-spin" />
          Checking…
        {:else}
          <SearchCheck data-icon="inline-start" />
          Check live
        {/if}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={!parsed.valid}
        onclick={copyNormalized}
      >
        {#if copied}<Check data-icon="inline-start" />{:else}<ClipboardCopy
            data-icon="inline-start"
          />{/if}
        {copied ? "Copied" : "Copy handle"}
      </Button>
    </div>
  </section>

  <section
    class="rounded-lg border bg-card p-4 sm:p-6"
    aria-labelledby="handle-result-title"
  >
    <h2 id="handle-result-title" class="text-lg font-semibold">Result</h2>
    <p class="mt-1 text-sm text-muted-foreground">
      Syntax checks run locally. Live checks contact the account server or
      Bluesky API.
    </p>

    <div
      class={[
        "mt-5 min-h-64 rounded-xl border p-5",
        live.status === "found" && "border-primary/30 bg-primary/[0.04]",
        live.status === "not-found" &&
          "border-destructive/30 bg-destructive/[0.04]",
      ]}
      aria-live="polite"
    >
      <p
        class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
      >
        {live.status === "idle"
          ? "Ready when you are"
          : live.status.replace("-", " ")}
      </p>
      <p class="mt-3 text-base font-medium">{live.message}</p>

      {#if live.status === "found" && live.identity}
        <div class="mt-5 rounded-lg border bg-background p-4">
          <p class="text-xs font-medium text-muted-foreground">
            Account address
          </p>
          <p class="mt-1 break-all font-mono text-sm">{live.identity}</p>
        </div>
      {/if}

      {#if parsed.valid}
        <div class="mt-5 flex flex-wrap gap-3 text-sm font-medium">
          {#if resultProfileUrl}
            <a
              href={resultProfileUrl}
              target="_blank"
              rel="noreferrer"
              class="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3 hover:bg-muted"
            >
              {resultProfileLabel}
              <ExternalLink class="size-4" />
            </a>
          {/if}
          {#if parsed.lookupUrl}
            <a
              href={parsed.lookupUrl}
              target="_blank"
              rel="noreferrer"
              class="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3 hover:bg-muted"
            >
              Open lookup URL <ExternalLink class="size-4" />
            </a>
          {/if}
        </div>
      {/if}
    </div>
  </section>
</div>
