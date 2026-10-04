import planCatalog from "@openpost/plan-catalog/catalog.json" with { type: "json" };

const BYTES_PER_GIGABYTE = 1_000_000_000;

const openPostPlans = {
  title: "OpenPost Hosted costs and limits",
  text: "Prices are in USD before tax. Limits apply separately to each workspace. Hosted signups are currently on a waitlist while the remaining platform approvals are completed. Check admission and your exact account and format before choosing a plan.",
  table: {
    caption: "OpenPost Hosted plans",
    columns: ["Plan", "Billing", "Workspaces", "Limits per workspace"],
    rows: planCatalog.plans.map((plan) => [
      plan.name,
      `$${plan.monthly_price_usd}/month or $${plan.annual_price_usd}/year`,
      String(plan.limits.workspaces),
      `${plan.limits.social_accounts} social accounts, ${plan.limits.team_members} ${plan.limits.team_members === 1 ? "person" : "people"}, ${plan.limits.scheduled_posts_monthly} scheduled posts/month, ${plan.limits.media_bytes_stored / BYTES_PER_GIGABYTE} GB storage and ${plan.limits.media_bytes_uploaded_monthly / BYTES_PER_GIGABYTE} GB uploads/month`,
    ]),
  },
  items: [
    `All Hosted plans include the same tools. The ${planCatalog.purchase_terms.trial_days}-day trial ${planCatalog.purchase_terms.card_required ? "requires a card" : "does not require a card"}; $${planCatalog.purchase_terms.due_today_usd} is due at checkout when admission is open.`,
    "A scheduled post counts once across its destinations and thread segments. Monthly allowances reset by calendar month in UTC. Provider quotas can impose further limits.",
    "Self-hosting has no software fee. Budget separately for infrastructure, backups, storage, provider API use, and maintenance.",
  ],
};

const openPostSources = [
  { label: "OpenPost pricing and usage limits", href: "https://openpo.st/pricing" },
  {
    label: "OpenPost admission and product scope",
    href: "https://github.com/getopenpost/openpost#readme",
  },
  { label: "OpenPost channel requirements", href: "https://openpo.st/platforms" },
];

// Review competitor facts against these official sources before changing the date.
export const comparisonGuides = [
  {
    slug: "openpost-vs-buffer",
    reviewedAt: "2026-10-04",
    question: "OpenPost vs Buffer: which fits your content workflow?",
    socialDescription:
      "Compare costs, account limits, content creation, collaboration, and reasons to choose either tool.",
    answer:
      "Choose Buffer when you want a free starting plan or paid scheduling for a few channels. Evaluate OpenPost when you want to turn product work into posts, edit the media, and keep channel versions and automation together. OpenPost Hosted admission is currently on a waitlist, which matters if you need to start today.",
    sections: [
      {
        title: "When Buffer is the better fit",
        text: "Buffer is a practical choice for scheduling finished content on a small number of accounts. Its Free plan lets you begin without a subscription. Team includes unlimited users and approval workflows, which can suit a large group managing relatively few channels.",
        items: [
          "Free allows three connected channels, one user, and ten queued posts per channel. There is also a lifetime cap of eight distinct channel connections.",
          "Buffer supports API and MCP access as well as external automation integrations. Agent access alone is not a reason to switch tools.",
        ],
      },
      {
        title: "Buffer costs and limits",
        text: "These USD rates apply to the first ten paid channels. Each connected account is billed, including channels previously used on Free. Further channels receive volume discounts. Annual prices below are the yearly cost per channel, not a monthly invoice.",
        table: {
          caption: "Buffer plans",
          columns: ["Plan", "Billing", "Channels", "People and scheduling"],
          rows: [
            ["Free", "$0", "3", "1 user; 10 queued posts/channel"],
            [
              "Essentials",
              "$6/channel/month or $60/channel/year",
              "Pay per connected channel",
              "1 user; paid scheduling subject to fair use",
            ],
            [
              "Team",
              "$12/channel/month or $120/channel/year",
              "Pay per connected channel",
              "Unlimited users; approvals; paid scheduling subject to fair use",
            ],
          ],
        },
        items: [
          "For five channels on monthly billing, Essentials costs $30 and Team costs $60. Use Buffer's calculator for larger account counts and check its current fair-use terms.",
        ],
      },
      openPostPlans,
      {
        title: "When OpenPost is the better fit",
        text: "Evaluate OpenPost if preparing content takes more of your time than placing finished posts in a queue. Its Image Editor, Video Editor, Recorder, media library, and channel-specific versions keep creation and publishing in one workspace. Built-in Workflows can prepare drafts from releases, feeds, or API responses for review.",
        items: [
          "OpenPost offers self-hosting if you need to operate your own instance. You own provider setup and maintenance.",
          "Compare the actual workflow, not a feature count. Test media editing, one destination-specific change, and a failed delivery before moving important posts.",
        ],
      },
      {
        title: "Check the same real post in both tools",
        text: "Connect the accounts and formats you actually use. Prepare the same announcement and media, adjust one channel, and inspect the schedule and outcome. Compare the complete bill for your accounts and people. Keep your existing scheduler until the replacement has passed this check.",
      },
    ],
    sources: [
      {
        label: "Buffer plan prices, limits, and features",
        href: "https://support.buffer.com/articles/buffer-pricing-and-features-6pJrOPuzIt",
      },
      { label: "Buffer pricing calculator and fair-use terms", href: "https://buffer.com/pricing" },
      ...openPostSources,
      { label: "OpenPost Workflows", href: "https://openpo.st/docs/workflows" },
    ],
    next: { label: "Compare OpenPost plans", href: "/pricing" },
  },
  {
    slug: "openpost-vs-postiz",
    reviewedAt: "2026-10-04",
    question: "OpenPost vs Postiz: which fits your content workflow?",
    socialDescription:
      "Compare Hosted plans, channel and posting limits, media workflows, and the work involved in self-hosting.",
    answer:
      "Both products offer hosted and self-hosted publishing. Choose Postiz if its channel coverage or higher posting allowance fits your needs. Evaluate OpenPost for integrated image and timeline video editing, recording, and reviewed content workflows. OpenPost Hosted admission is currently on a waitlist, so it may not fit an immediate move.",
    sections: [
      {
        title: "When Postiz is the better fit",
        text: "Postiz documents channels beyond OpenPost's current integration list, including Reddit. It also supports per-channel content, a calendar, AI media tools, and automation. Check the exact account type and publishing format instead of treating either product's integration list as a guarantee.",
        items: [
          "Postiz includes API, CLI, MCP, and webhooks on every Hosted plan. These are shared capabilities, not an OpenPost advantage.",
          "Postiz's paid plans advertise unlimited monthly posts. Confirm applicable provider and service limits for your workload.",
        ],
      },
      {
        title: "Postiz costs and limits",
        text: "The annual rates below are monthly equivalents paid yearly, as listed by Postiz. AI generation and clipping have separate plan allowances. Verify the current checkout total and the allowance for any media feature you rely on.",
        table: {
          caption: "Postiz Hosted plans",
          columns: ["Plan", "Billing", "Channels", "People and scheduling"],
          rows: [
            [
              "Standard",
              "$29/month; $23/month equivalent on annual billing",
              "5",
              "Unlimited monthly posts",
            ],
            [
              "Team",
              "$39/month; $31/month equivalent on annual billing",
              "10",
              "Unlimited members and monthly posts",
            ],
            [
              "Pro",
              "$49/month; $39/month equivalent on annual billing",
              "30",
              "Unlimited members and monthly posts",
            ],
            [
              "Ultimate",
              "$99/month; $79/month equivalent on annual billing",
              "100",
              "Unlimited members and monthly posts",
            ],
          ],
        },
        items: [
          "Postiz offers a seven-day trial. For ten channels and multiple people, compare its Team plan with the OpenPost plan that covers your people and workspaces.",
        ],
      },
      openPostPlans,
      {
        title: "When OpenPost is the better fit",
        text: "Evaluate OpenPost when you want to record a product demonstration, edit it on a multitrack timeline, prepare reusable images, and adapt one source idea for several channels. Its Workflows can combine triggers, conditions, AI steps, and review before scheduling. Postiz also offers media editing and automation, so test the particular editing and review tasks you need.",
      },
      {
        title: "Compare self-hosting responsibilities",
        text: "OpenPost's default deployment uses one container with SQLite and local media storage. Postiz's recommended Docker Compose stack includes the application, PostgreSQL, Redis, and Temporal. OpenPost can fit an operator who wants fewer services to maintain; Postiz can fit an operator already comfortable with its stack and provider coverage.",
        items: [
          "Both require you to maintain backups, upgrades, storage, credentials, and the provider applications your accounts need.",
          "Postiz documents a Polotno license requirement for its self-hosted design editor. Check that requirement and any AI provider costs before budgeting media features.",
          "Before switching, test one real account, a media post, a channel-specific edit, and recovery from a failed publish. Keep your old setup until the new one works for your exact destinations.",
        ],
      },
    ],
    sources: [
      { label: "Postiz Hosted prices and plan allowances", href: "https://postiz.com/pricing" },
      {
        label: "Postiz product and channel documentation",
        href: "https://docs.postiz.com/general/introduction",
      },
      {
        label: "Postiz installation options",
        href: "https://docs.postiz.com/self-host/installation/overview",
      },
      {
        label: "Postiz self-hosted design editor requirements",
        href: "https://docs.postiz.com/self-host/configuration/polotno",
      },
      ...openPostSources,
      { label: "OpenPost self-hosting", href: planCatalog.self_hosted.documentation_url },
    ],
    next: { label: "Compare OpenPost plans", href: "/pricing" },
  },
];
