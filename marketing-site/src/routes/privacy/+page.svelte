<script lang="ts">
  import { resolve } from "$app/paths";
  import {
    formatLegalDate,
    formatPolicyEffectiveDate,
    legalChangeHistory,
    legalPolicy,
    privacyInventory,
    type LegalPolicyKey,
  } from "@openpost/legal-policy";
  import { siteUrl } from "../_marketing";

  const effectiveDate = formatPolicyEffectiveDate(legalPolicy.privacy);
  const inventoryReviewedOn = formatLegalDate(privacyInventory.reviewed_on);
  const storageTechnologies = [
    "cookie",
    "localStorage",
    "sessionStorage",
    "IndexedDB",
    "OPFS",
    "Cache Storage",
  ] as const;

  function policyName(document: LegalPolicyKey) {
    if (document === "terms") return "Terms of Service";
    if (document === "refunds") return "Refund Policy";
    return "Privacy Policy";
  }

  function policyPath(document: LegalPolicyKey) {
    if (document === "terms") return "/terms" as const;
    if (document === "refunds") return "/refunds" as const;
    return "/privacy" as const;
  }
</script>

<svelte:head>
  <title>Privacy Policy - OpenPost</title>
  <meta
    name="description"
    content="How OpenPost collects, uses, shares, protects, exports, and deletes personal data for the hosted service."
  />
  <link rel="canonical" href={`${siteUrl}/privacy`} />
</svelte:head>

<header class="border-b py-14 sm:py-20">
  <div class="reading-shell">
    <p class="section-label">Legal</p>
    <h1
      class="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
    >
      Privacy Policy
    </h1>
    <p class="text-muted-foreground mt-5 text-lg leading-8">
      What the hosted OpenPost service processes, why it does so, and the
      choices available to you.
    </p>
    <div class="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
      <a
        href={resolve("/security")}
        class="focus-ring text-primary inline-flex min-h-11 items-center rounded-md"
        >Security details</a
      >
      <a
        href={resolve("/trust")}
        class="focus-ring text-primary inline-flex min-h-11 items-center rounded-md"
        >Managed service trust register</a
      >
    </div>
  </div>
</header>

<section class="section-pad">
  <article class="reading-shell prose dark:prose-invert">
    <p><strong>Effective date:</strong> {effectiveDate}</p>
    <p><strong>Policy version:</strong> {legalPolicy.privacy.version}</p>

    <aside class="not-prose bg-muted/30 my-10 rounded-xl border p-6 sm:p-8">
      <p class="text-primary text-sm font-semibold tracking-wide uppercase">
        Plain-language summary
      </p>
      <p class="text-muted-foreground mt-3 text-sm leading-6">
        {privacyInventory.summary_notice}
      </p>
      <ul class="mt-5 space-y-3 text-sm leading-6">
        {#each privacyInventory.summary_points as point (point)}
          <li class="flex gap-3">
            <span class="text-primary" aria-hidden="true">•</span>
            <span>{point}</span>
          </li>
        {/each}
      </ul>
      <p class="text-muted-foreground mt-5 text-sm leading-6">
        The <a
          class="focus-ring text-primary rounded-sm font-medium underline underline-offset-4"
          href={resolve("/terms")}>Terms of Service</a
        > set the contract for the hosted service. The full sections below state the
        privacy rules.
      </p>
    </aside>

    <h2>1. Who is responsible</h2>
    <p>
      The hosted OpenPost service at <a href="https://app.openpost.social"
        >app.openpost.social</a
      >
      is operated by Rodrigo Dias in Porto, Portugal. For privacy requests, email
      <a href="mailto:openpost@rgo.pt">openpost@rgo.pt</a>. OpenPost is the data
      controller for account and service data described in this policy.
    </p>
    <p>
      A self-hosted OpenPost installation is controlled by its operator. This
      policy does not govern an independent self-hosted installation; contact
      that operator about its practices.
    </p>

    <h2>2. Data we process</h2>
    <ul>
      <li>
        <strong>Account and workspace data:</strong> email address, display name,
        profile image, workspace and organization details, roles, invitations, and
        settings.
      </li>
      <li>
        <strong>Post data:</strong> drafts, scheduled and published content, media,
        account versions, OpenPost Image Editor designs and saved versions, explicitly
        cloud-saved OpenPost Video Editor projects, templates, brand settings, prompts,
        schedules, post status, and job history.
      </li>
      <li>
        <strong>Analytics data:</strong> account and post numbers, past results, update
        status, and safe platform error codes. Analytics records do not contain full
        platform replies, access tokens, post text, or direct messages.
      </li>
      <li>
        <strong>Product and website telemetry:</strong> cookieless public page views
        and selected interactions; opaque signed-in user and workspace identifiers;
        product and service events; release, route-template, status, and sanitized
        error facts. We do not send post content, media, request bodies, credentials,
        email addresses, names, usernames, query strings, or raw URLs as telemetry
        properties.
      </li>
      <li>
        <strong>Brand font records:</strong> custom WOFF2, TTF, or OTF files, family
        and style details, and the account and time associated with the required font-license
        acknowledgement.
      </li>
      <li>
        <strong>Connected-account data:</strong> social network, account ID, username,
        profile, supported features, X plan when relevant, granted access, and encrypted
        access or refresh tokens. OpenPost does not ask for your social-network password.
      </li>
      <li>
        <strong>Security data:</strong> password hashes, session identifiers, passkey
        public-key material, TOTP settings, API token details, IP address, browser
        details, sign-in and token activity, and password-reset records. OpenPost
        never stores a readable account password.
      </li>
      <li>
        <strong>Billing data:</strong> plan access, subscription, checkout, customer,
        transaction, and billing-status identifiers received from Paddle or the payment
        provider identified at checkout. OpenPost does not receive or store full payment-card
        details.
      </li>
      <li>
        <strong>Support and service data:</strong> messages you send, service logs,
        errors, request timing, usage counters, and abuse-prevention signals.
      </li>
    </ul>

    <h2>3. How we receive data</h2>
    <p>
      We receive data from you when you register, set up a workspace, upload
      content, connect a social network, buy a plan, or contact support. We also
      receive account and post data from the networks you connect, billing
      status from Paddle or the payment provider identified at checkout, and
      limited technical data when your browser or client uses the service.
    </p>
    <p>
      Camera access is requested only after you choose a camera action. A live
      preview stays in the browser and is not saved. A still photo is uploaded
      to the selected workspace only after you choose to use it. OpenPost Video
      Editor can optionally record a camera track; that recording and its local
      project stay in browser storage until you choose a cloud save, Media save,
      or post handoff.
    </p>

    <h2>4. Why we use data</h2>
    <ul>
      <li>
        Provide, secure, and support accounts, workspaces, publishing,
        analytics, and automation.
      </li>
      <li>Send content to the social networks and accounts you select.</li>
      <li>
        Draft image alternative text when automatic captioning is enabled.
      </li>
      <li>
        Process subscriptions, enforce plan limits, and keep billing records.
      </li>
      <li>
        Detect abuse, investigate failures, and protect users and the service.
      </li>
      <li>
        Comply with law, enforce the Terms of Service, and resolve disputes.
      </li>
      <li>Improve the service using technical logs and error data.</li>
      <li>
        Understand anonymous traffic and selected interactions on the marketing
        and documentation sites.
      </li>
    </ul>
    <p>
      For users in the European Economic Area, these uses rely on performing our
      contract with you, our legitimate interests in operating and securing the
      service, compliance with legal obligations, or consent where consent is
      required. You can withdraw consent without affecting earlier lawful
      processing.
    </p>

    <h2>5. When data is shared</h2>
    <p>We share data only as needed with:</p>
    <ul>
      <li>
        <strong>Social networks you choose</strong>, such as X, Mastodon
        servers, Bluesky, LinkedIn, Meta services, TikTok, or YouTube, to
        connect accounts and perform requested publishing actions. Their terms
        and privacy policies then apply.
      </li>
      <li>
        <strong>An identity provider you choose</strong>, such as Google, when
        you use that provider to sign in or link an identity.
      </li>
      <li>
        <strong>Hosting companies</strong> that run the app, database, media, email,
        network, analytics, and backups under their service terms.
      </li>
      <li>
        <strong>OpenRouter and selected AI model providers</strong>, when
        automatic image captioning is enabled, to process a 400-pixel JPEG
        thumbnail and up to 1,000 characters of the relevant draft or thread
        segment as untrusted context. OpenPost does not send the original image
        for this feature. Their service and privacy terms apply.
      </li>
      <li>
        <strong>Paddle and prior payment providers</strong> for checkout, subscriptions,
        tax, billing records, refunds, fraud prevention, and customer portals. Paddle
        acts as Merchant of Record for orders it processes.
      </li>
      <li>
        <strong>Stock-media services you search</strong> to return requested photo
        or video results and record provider-required selection or download events.
      </li>
      <li>
        <strong>The disclosed feedback recipient</strong> when you choose to send
        the in-app report, including its text, optional screenshot, and the diagnostics
        shown before submission.
      </li>
      <li>
        <strong>Authorities or other parties</strong> when reasonably necessary to
        comply with law, protect rights and safety, investigate abuse, or complete
        a business reorganization.
      </li>
    </ul>
    <p>
      OpenPost does not sell personal data, build advertising profiles, or share
      personal data for cross-context behavioral advertising.
    </p>
    <p>
      The dated <a href={resolve("/trust")}>managed service trust register</a>
      names current data locations, service providers, user-directed recipients, international-transfer
      facts, and the human production-access boundary.
    </p>

    <h2>6. Google and YouTube API data</h2>
    <p>
      If you connect YouTube, OpenPost uses Google API data only to provide the
      connection, video-publishing, and channel or video analytics features you
      request. That use and transfer comply with the
      <a
        href="https://developers.google.com/terms/api-services-user-data-policy"
        >Google API Services User Data Policy</a
      >, including its Limited Use requirements. OpenPost does not use Google
      user data for ads, credit decisions, or unrelated profiling.
    </p>
    <p>
      OpenPost uses YouTube API Services. Google's handling of information is
      described in the
      <a href="https://policies.google.com/privacy">Google Privacy Policy</a>.
    </p>
    <p>
      You can disconnect a YouTube account in OpenPost and revoke access from
      your
      <a href="https://security.google.com/settings/security/permissions"
        >Google account permissions</a
      >.
    </p>

    <h2>7. Retention and deletion</h2>
    <p>
      The schedule below states who operates each managed data category, why it
      is kept, its current duration, and the event that deletes it or ends its
      use. “No general age-based purge” means the database does not currently
      delete that category merely because it reached a fixed age. Authorization
      can still expire before a row is physically removed.
    </p>
    <p>
      You can download an account export or request permanent deletion from
      account settings. Deletion can be delayed when you must first transfer
      shared ownership, cancel active billing, or preserve the last required
      instance administrator. Primary account and personal workspace data are
      removed when deletion completes. The managed service makes daily database
      and media recovery copies in root-restricted operator storage. Routine
      database dumps and changed or deleted media versions are pruned by a daily
      job after they become more than 14 days old. A copy can therefore remain
      until the next daily run. Operator-created repair or incident snapshots
      follow a separate review and are kept only while needed for recovery,
      security, legal duties, fraud prevention, or enforcing legal rights.
      OpenPost does not add a separate application-level encryption layer to
      each backup artifact.
    </p>
    <p><strong>Retention schedule reviewed:</strong> {inventoryReviewedOn}</p>

    <div
      class="not-prose my-8 overflow-x-auto rounded-xl border"
      role="region"
      aria-label="Managed-service retention schedule"
    >
      <table class="min-w-[76rem] border-collapse text-left text-sm">
        <caption class="sr-only">
          Managed-service data retention schedule and deletion triggers
        </caption>
        <thead class="bg-muted/50">
          <tr>
            <th class="w-64 border-b p-4 font-semibold" scope="col">Category</th
            >
            <th class="w-72 border-b p-4 font-semibold" scope="col"
              >Owner and purpose</th
            >
            <th class="w-80 border-b p-4 font-semibold" scope="col">Duration</th
            >
            <th class="w-96 border-b p-4 font-semibold" scope="col"
              >Deletion trigger and limits</th
            >
          </tr>
        </thead>
        <tbody class="divide-y">
          {#each privacyInventory.managed_retention as entry (entry.id)}
            <tr class="align-top">
              <th class="p-4 font-semibold" scope="row">
                {entry.category}
                <span
                  class="text-muted-foreground mt-2 block text-xs leading-5 font-normal"
                  >{entry.includes}</span
                >
              </th>
              <td class="p-4 leading-6">
                <span class="font-medium">{entry.owner}</span>
                <span class="text-muted-foreground mt-2 block"
                  >{entry.purpose}</span
                >
              </td>
              <td class="text-muted-foreground p-4 leading-6">
                {entry.duration}
              </td>
              <td class="p-4 leading-6">
                {entry.deletion_trigger}
                <span class="text-muted-foreground mt-2 block"
                  ><strong class="text-foreground font-medium">Limits:</strong>
                  {entry.exceptions}</span
                >
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <h2>8. Cookies and browser storage</h2>
    <p>
      The inventory below covers first-party cookies, localStorage,
      sessionStorage, IndexedDB databases and object stores, Origin Private File
      System (OPFS) roots and patterns, and Cache Storage names used by the app,
      marketing site, and documentation site. An exact identifier is one fixed
      name. A prefix covers names with a generated suffix. The inventory was
      reviewed on {inventoryReviewedOn}.
    </p>
    <p>
      OpenPost Image Editor background removal runs in your browser with model
      and runtime files served by the OpenPost operator. Source pixels are not
      sent to a background-removal service. A result is uploaded to the selected
      workspace only when processing succeeds.
    </p>
    <p>
      The managed app, service, marketing site, and documentation site use
      PostHog EU Cloud for product, service, error, and website telemetry. Public
      traffic remains cookieless and personless. The signed-in app and backend use
      the same opaque OpenPost user ID to join product actions to service outcomes.
      Browser persistence is memory-only; autocapture, session replay, console
      capture, network bodies, advertising profiles, and cross-site tracking are
      disabled. The privacy-enhanced YouTube player is loaded only when you open
      the product demo; YouTube may then process device and playback data.
    </p>
    <p>
      OpenPost Video Editor live previews, optional screen, camera, and audio
      recording, editing, transcription, voice detection, framing analysis, and
      export run in the browser. Model files are downloaded only after the user
      starts the related tool. Local project data, recordings, sources, and
      exports are uploaded only when the user chooses a cloud save, Media save,
      or post handoff.
    </p>

    {#each storageTechnologies as technology (technology)}
      {@const entries = privacyInventory.browser_storage.filter(
        (entry) => entry.technology === technology,
      )}
      <h3>{technology}</h3>
      <div
        class="not-prose my-6 overflow-x-auto rounded-xl border"
        role="region"
        aria-label={`${technology} identifier inventory`}
      >
        <table class="min-w-[70rem] border-collapse text-left text-sm">
          <caption class="sr-only">{technology} identifier inventory</caption>
          <thead class="bg-muted/50">
            <tr>
              <th class="w-64 border-b p-4 font-semibold" scope="col"
                >Identifier</th
              >
              <th class="w-80 border-b p-4 font-semibold" scope="col"
                >Owner and purpose</th
              >
              <th class="w-96 border-b p-4 font-semibold" scope="col"
                >Scope and duration</th
              >
              <th class="w-40 border-b p-4 font-semibold" scope="col"
                >Necessity</th
              >
            </tr>
          </thead>
          <tbody class="divide-y">
            {#each entries as entry (entry.id)}
              <tr class="align-top">
                <th class="p-4 font-normal" scope="row">
                  <code class="break-all">{entry.identifier}</code>
                  <span
                    class="text-muted-foreground mt-2 block text-xs tracking-wide uppercase"
                    >{entry.identifier_kind}</span
                  >
                </th>
                <td class="p-4 leading-6">
                  <span class="font-medium">{entry.owner}</span>
                  <span class="text-muted-foreground mt-2 block"
                    >{entry.purpose}</span
                  >
                </td>
                <td class="p-4 leading-6">
                  {entry.scope}
                  <span class="text-muted-foreground mt-2 block"
                    ><strong class="text-foreground font-medium"
                      >Duration:</strong
                    >
                    {entry.duration}</span
                  >
                </td>
                <td class="p-4 leading-6">
                  {entry.necessity === "strictly_necessary"
                    ? "Strictly necessary"
                    : "Functional"}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/each}

    <h2>9. International transfers</h2>
    <p>
      Your selected social networks and some service providers may process data
      outside Portugal or the European Economic Area. When OpenPost controls a
      transfer and a safeguard is required, it must use an adequacy decision,
      contractual safeguards, or another lawful transfer method. The managed
      service trust register states the current provider-specific facts and any
      unresolved documentation gap. Publishing to a social network is also a
      transfer that you choose.
    </p>

    <h2>10. Your rights</h2>
    <p>
      Depending on where you live, you may have rights to access, correct,
      export, delete, restrict, or object to processing, and to withdraw
      consent. Use account settings for export and deletion or email <a
        href="mailto:openpost@rgo.pt">openpost@rgo.pt</a
      >. We may need to verify your identity before completing a request.
    </p>
    <p>
      You may also complain to your local data-protection authority. In
      Portugal, this is the
      <a href="https://www.cnpd.pt/"
        >Comissão Nacional de Proteção de Dados (CNPD)</a
      >.
    </p>

    <h2>11. Security</h2>
    <p>
      OpenPost uses encrypted social account tokens, password hashing, secure
      session cookies, limited tool tokens that you can remove, access controls,
      TOTP, passkeys, request limits, backups, and checks for unsafe software
      packages. No internet service can guarantee full security. Report a
      suspected security flaw to
      <a href="mailto:openpost+security@rgo.pt">openpost+security@rgo.pt</a>.
    </p>

    <h2>12. Children</h2>
    <p>
      The hosted service is not directed to anyone under 18. Do not create an
      account if you are under 18.
    </p>

    <h2>13. Changes and contact</h2>
    <p>
      We may update this policy when the service or legal requirements change.
      Material changes will be announced in the service or by email when
      appropriate, and the policy version and effective date will change.
      Corrections to spelling, formatting, or links that do not change meaning
      keep the same version. Questions and requests can be sent to
      <a href="mailto:openpost@rgo.pt">openpost@rgo.pt</a>.
    </p>
    <p>
      {legalChangeHistory.scope} This history was reviewed on {formatLegalDate(
        legalChangeHistory.reviewed_on,
      )}.
    </p>
    <div class="not-prose mt-8 divide-y border-y">
      {#each legalChangeHistory.entries as entry (`${entry.document}:${entry.version}`)}
        <section class="py-6">
          <h3 class="text-base font-semibold">
            <a
              class="focus-ring text-primary rounded-sm underline underline-offset-4"
              href={resolve(policyPath(entry.document))}
              >{policyName(entry.document)}</a
            >
            <span class="text-muted-foreground font-normal"
              >version {entry.version}</span
            >
          </h3>
          <p class="text-muted-foreground mt-2 text-sm leading-6">
            Effective {formatLegalDate(entry.effective_date)}
          </p>
          <ul class="mt-3 space-y-2 text-sm leading-6">
            {#each entry.changes as change (change)}
              <li class="flex gap-3">
                <span class="text-primary" aria-hidden="true">•</span>
                <span>{change}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  </article>
</section>
