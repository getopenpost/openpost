export type ClaimBasis = "Direct source" | "Interpretation";

export interface ClaimSource {
  label: string;
  href: string;
}

export interface ClaimEvidence {
  owner: string;
  basis: ClaimBasis;
  reviewedOn: string;
  reviewDueOn: string;
  qualifier: string;
  sources: readonly ClaimSource[];
}

const reviewedOn = "2026-08-09";
const reviewDueOn = "2026-11-09";

function source(label: string, href: string): ClaimSource {
  return { label, href };
}

function evidence(
  basis: ClaimBasis,
  qualifier: string,
  sources: readonly ClaimSource[],
) {
  return { basis, qualifier, sources } as const;
}

const openPostEvidence = {
  Publishing: evidence(
    "Direct source",
    "Current OpenPost managed and self-hosted publishing workflow; provider and account rules still apply.",
    [
      source(
        "OpenPost composing guide",
        "https://docs.openpost.social/usage/composing-posts",
      ),
    ],
  ),
  "Analytics and engagement": evidence(
    "Direct source",
    "Current stored analytics and supported communications scope; coverage depends on provider permissions.",
    [
      source(
        "OpenPost analytics guide",
        "https://docs.openpost.social/usage/analytics",
      ),
      source(
        "OpenPost communications guide",
        "https://docs.openpost.social/usage/communications",
      ),
    ],
  ),
  Automation: evidence(
    "Direct source",
    "Current HTTP API, CLI, and MCP behavior; all paths enforce authorization and workspace scope.",
    [
      source(
        "OpenPost developer docs",
        "https://docs.openpost.social/development/",
      ),
      source("OpenPost MCP guide", "https://docs.openpost.social/mcp/"),
    ],
  ),
  "Hosting and source": evidence(
    "Direct source",
    "Current AGPL source and deployment options.",
    [
      source("OpenPost source", "https://github.com/rodrgds/openpost"),
      source(
        "OpenPost self-hosting guide",
        "https://docs.openpost.social/self-hosting/",
      ),
    ],
  ),
  "Beyond publishing": evidence(
    "Direct source",
    "Current analytics and communications scope; OpenPost does not claim social listening or advertising tools.",
    [
      source(
        "OpenPost analytics guide",
        "https://docs.openpost.social/usage/analytics",
      ),
      source(
        "OpenPost communications guide",
        "https://docs.openpost.social/usage/communications",
      ),
    ],
  ),
  Hosting: evidence(
    "Direct source",
    "Current managed and self-hosted deployment options.",
    [
      source(
        "OpenPost self-hosting guide",
        "https://docs.openpost.social/self-hosting/",
      ),
    ],
  ),
  "Platforms and account versions": evidence(
    "Direct source",
    "Current destination-specific version model; exact formats and controls vary by account.",
    [
      source(
        "OpenPost destination options",
        "https://docs.openpost.social/usage/destination-options",
      ),
    ],
  ),
  "Writing and review": evidence(
    "Direct source",
    "Current composer, preview, prompt, media, and validation workflow.",
    [
      source(
        "OpenPost composing guide",
        "https://docs.openpost.social/usage/composing-posts",
      ),
    ],
  ),
  "Network breadth": evidence(
    "Direct source",
    "Implemented provider catalogue; implementation is not a current managed-service certification claim.",
    [
      source(
        "OpenPost provider limits",
        "https://docs.openpost.social/providers/platform-limits",
      ),
    ],
  ),
  "Product scope": evidence(
    "Direct source",
    "Current product and workspace documentation.",
    [source("OpenPost user guide", "https://docs.openpost.social/usage/")],
  ),
  "Self-hosting": evidence(
    "Direct source",
    "Current single-service deployment and default storage architecture.",
    [
      source(
        "OpenPost self-hosting guide",
        "https://docs.openpost.social/self-hosting/",
      ),
    ],
  ),
  "Scheduling horizon": evidence(
    "Direct source",
    "Current scheduling behavior; plan quotas and provider readiness still apply.",
    [
      source(
        "OpenPost scheduling guide",
        "https://docs.openpost.social/usage/scheduling",
      ),
    ],
  ),
  "Threads and hosting": evidence(
    "Direct source",
    "Current thread workflow and deployment options; destination support remains account-specific.",
    [
      source(
        "OpenPost threads guide",
        "https://docs.openpost.social/usage/threads",
      ),
      source(
        "OpenPost self-hosting guide",
        "https://docs.openpost.social/self-hosting/",
      ),
    ],
  ),
  "Product model": evidence(
    "Direct source",
    "Current AGPL edition and managed or self-hosted deployment choices.",
    [
      source("OpenPost source", "https://github.com/rodrgds/openpost"),
      source(
        "OpenPost self-hosting guide",
        "https://docs.openpost.social/self-hosting/",
      ),
    ],
  ),
  "Publishing suite": evidence(
    "Direct source",
    "Current composer, media, scheduling, and publication-result workflow.",
    [source("OpenPost user guide", "https://docs.openpost.social/usage/")],
  ),
  Runtime: evidence(
    "Direct source",
    "Current Go service, SQLite default, and no required Redis dependency.",
    [
      source(
        "OpenPost self-hosting guide",
        "https://docs.openpost.social/self-hosting/",
      ),
    ],
  ),
} as const;

export const comparisonEvidenceRegister = {
  buffer: {
    reviewedOn,
    reviewDueOn,
    qualifier:
      "Public English product, pricing, and developer pages. Features and prices vary by plan, channel count, and billing period.",
    rows: {
      Publishing: evidence(
        "Direct source",
        "Free, Essentials, and Team plan comparison.",
        [source("Buffer pricing", "https://buffer.com/pricing")],
      ),
      "Analytics and engagement": evidence(
        "Direct source",
        "Insights and Community capabilities vary by plan and channel.",
        [source("Buffer pricing", "https://buffer.com/pricing")],
      ),
      Automation: evidence(
        "Direct source",
        "Published API and MCP documentation; request and key limits vary by plan.",
        [
          source("Buffer API", "https://buffer.com/api"),
          source(
            "Buffer MCP guide",
            "https://developers.buffer.com/guides/integrations/mcp.html",
          ),
        ],
      ),
      "Hosting and source": evidence(
        "Interpretation",
        "Buffer is presented through its hosted product and pricing pages; this row does not infer private deployment options.",
        [source("Buffer pricing", "https://buffer.com/pricing")],
      ),
    },
  },
  hootsuite: {
    reviewedOn,
    reviewDueOn,
    qualifier:
      "Public English plans and MCP pages. Prices are plan-, seat-, billing-, tax-, and region-dependent; Enterprise is custom.",
    rows: {
      Publishing: evidence(
        "Direct source",
        "Standard through Enterprise plan comparison.",
        [source("Hootsuite plans", "https://www.hootsuite.com/plans")],
      ),
      "Beyond publishing": evidence(
        "Direct source",
        "Inbox, analytics, listening, reporting, and governance vary by plan and product.",
        [source("Hootsuite plans", "https://www.hootsuite.com/plans")],
      ),
      Automation: evidence(
        "Direct source",
        "Perch, Nest, Lumen, and Parliament MCP capabilities require the corresponding Hootsuite product access.",
        [
          source(
            "Hootsuite MCP connectors",
            "https://www.hootsuite.com/integrations/mcp",
          ),
        ],
      ),
      Hosting: evidence(
        "Direct source",
        "Public hosted plans and custom Enterprise offering.",
        [source("Hootsuite plans", "https://www.hootsuite.com/plans")],
      ),
    },
  },
  typefully: {
    reviewedOn,
    reviewDueOn,
    qualifier:
      "Public English pricing, help, API, and release pages. Social Sets, collaboration, automation, and usage limits vary by plan.",
    rows: {
      "Platforms and account versions": evidence(
        "Direct source",
        "Current Social Set and supported-account guidance; limits vary by plan.",
        [
          source(
            "Typefully Social Sets guide",
            "https://support.typefully.com/en/articles/8717684-social-sets-and-accounts",
          ),
        ],
      ),
      "Writing and review": evidence(
        "Direct source",
        "Current team collaboration and Social Set guidance.",
        [
          source(
            "Typefully collaboration guide",
            "https://support.typefully.com/en/articles/8717333-collaborating-in-teams",
          ),
        ],
      ),
      Automation: evidence(
        "Direct source",
        "Published API v2, MCP, webhooks, Zapier, and agent-tool release information.",
        [
          source("Typefully API v2", "https://typefully.com/docs/api"),
          source(
            "Typefully automation release",
            "https://typefully.com/changelog/all-new-api-zapier-integration-mcp-and-126",
          ),
        ],
      ),
      "Hosting and source": evidence(
        "Interpretation",
        "Typefully is presented through its hosted pricing and help surfaces; this row does not infer private deployment options.",
        [source("Typefully pricing", "https://typefully.com/pricing")],
      ),
    },
  },
  postiz: {
    reviewedOn,
    reviewDueOn,
    qualifier:
      "Public English product, pricing, API, and GitHub pages. Hosted plan limits and self-hosted behavior can differ by edition and revision.",
    rows: {
      "Network breadth": evidence(
        "Direct source",
        "Postiz's current public product catalogue advertises more than 30 channels and integrations.",
        [source("Postiz product", "https://postiz.com/")],
      ),
      Automation: evidence(
        "Direct source",
        "Current public API documentation and source repository.",
        [
          source("Postiz public API", "https://docs.postiz.com/public-api"),
          source("Postiz source", "https://github.com/gitroomhq/postiz-app"),
        ],
      ),
      "Product scope": evidence(
        "Direct source",
        "Public product and pricing pages for AI, analytics, editing, teams, and automation features.",
        [
          source("Postiz product", "https://postiz.com/"),
          source("Postiz pricing", "https://postiz.com/pricing"),
        ],
      ),
      "Self-hosting": evidence(
        "Direct source",
        "Current public source repository and self-host documentation linked from it.",
        [source("Postiz source", "https://github.com/gitroomhq/postiz-app")],
      ),
    },
  },
  "post-bridge": {
    reviewedOn,
    reviewDueOn,
    qualifier:
      "Public English help and API pages. Account limits, provider rules, plan access, and scheduling behavior can change.",
    rows: {
      Publishing: evidence(
        "Direct source",
        "Current cross-platform scheduling and account-specific customization guidance.",
        [
          source(
            "Post Bridge planning guide",
            "https://support.post-bridge.com/getting-started/how-to-plan-content-in-advance-with-post-bridge",
          ),
        ],
      ),
      "Scheduling horizon": evidence(
        "Direct source",
        "The current help article documents choosing dates and times up to two months ahead.",
        [
          source(
            "Post Bridge planning guide",
            "https://support.post-bridge.com/getting-started/how-to-plan-content-in-advance-with-post-bridge",
          ),
        ],
      ),
      Automation: evidence(
        "Direct source",
        "The API requires an active subscription and a separately priced API add-on.",
        [
          source(
            "Post Bridge API access and pricing",
            "https://support.post-bridge.com/api/post-bridge-api-overview-access-and-pricing",
          ),
        ],
      ),
      "Threads and hosting": evidence(
        "Direct source",
        "Current help explicitly excludes scheduled X and multi-post Threads reply chains.",
        [
          source(
            "Post Bridge thread limits",
            "https://support.post-bridge.com/social-media-scheduling/thread-scheduling-on-x-twitter-and-instagram-threads-current-limitations",
          ),
        ],
      ),
    },
  },
  mixpost: {
    reviewedOn,
    reviewDueOn,
    qualifier:
      "Public English pricing and GitHub pages. Lite, Pro, and Enterprise have different licenses, platforms, and features.",
    rows: {
      "Product model": evidence(
        "Direct source",
        "Current Lite, Pro, and Enterprise edition and license descriptions.",
        [
          source("Mixpost pricing and editions", "https://mixpost.app/pricing"),
          source("Mixpost source", "https://github.com/inovector/mixpost"),
        ],
      ),
      "Publishing suite": evidence(
        "Direct source",
        "Current edition comparison for publishing, analytics, engagement, approval, and team access.",
        [source("Mixpost pricing and editions", "https://mixpost.app/pricing")],
      ),
      Automation: evidence(
        "Direct source",
        "API, MCP, and webhooks are listed for paid editions.",
        [source("Mixpost pricing and editions", "https://mixpost.app/pricing")],
      ),
      Runtime: evidence(
        "Direct source",
        "Current self-hosted product and installation model; server requirements remain edition- and release-specific.",
        [
          source("Mixpost pricing and editions", "https://mixpost.app/pricing"),
          source("Mixpost source", "https://github.com/inovector/mixpost"),
        ],
      ),
    },
  },
} as const;

type EvidenceSlug = keyof typeof comparisonEvidenceRegister;
type ComparisonDraft = {
  slug: EvidenceSlug;
  name: string;
  reviewedAt: string;
  rows: readonly {
    area: keyof typeof openPostEvidence;
    openpost: string;
    competitor: string;
  }[];
};

function completeEvidence(
  owner: string,
  partial: ReturnType<typeof evidence>,
  policy: { reviewedOn: string; reviewDueOn: string },
  scopeQualifier = "",
): ClaimEvidence {
  return {
    owner,
    basis: partial.basis,
    reviewedOn: policy.reviewedOn,
    reviewDueOn: policy.reviewDueOn,
    qualifier: [partial.qualifier, scopeQualifier].filter(Boolean).join(" "),
    sources: partial.sources,
  };
}

export function attachComparisonEvidence<const T extends ComparisonDraft>(
  comparison: T,
) {
  const register = comparisonEvidenceRegister[comparison.slug];
  if (comparison.reviewedAt !== register.reviewedOn) {
    throw new Error(
      `${comparison.slug} reviewedAt must match its claim evidence register (${register.reviewedOn})`,
    );
  }

  return {
    ...comparison,
    reviewDueAt: register.reviewDueOn,
    evidenceQualifier: register.qualifier,
    rows: comparison.rows.map((row) => {
      const competitorEvidence =
        register.rows[row.area as keyof typeof register.rows];
      const openpostEvidence = openPostEvidence[row.area];
      if (!competitorEvidence || !openpostEvidence) {
        throw new Error(
          `${comparison.slug}/${row.area} is missing claim-level evidence`,
        );
      }
      return {
        ...row,
        evidence: {
          openpost: completeEvidence("OpenPost", openpostEvidence, register),
          competitor: completeEvidence(
            comparison.name,
            competitorEvidence,
            register,
            register.qualifier,
          ),
        },
      };
    }),
  };
}

export const comparisonEvidenceReview = { reviewedOn, reviewDueOn } as const;
