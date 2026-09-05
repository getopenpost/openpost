// Shared by the route manifest and the rendered guides so titles and answers stay together.
export const marketingGuides = [
  {
    slug: "best-social-media-tools-for-solo-founders",
    question: "What are the best social media tools for solo founders?",
    answer:
      "Start with the work you need to finish. Buffer is worth comparing for scheduling and adapting drafts. OpenPost is worth evaluating when you want drafts, media editing, destination-specific versions, and automation together. Postiz is another option to compare if self-hosting matters. Test your actual accounts before choosing.",
    sections: [
      {
        title: "Choose for your weekly workflow",
        text: "A founder sharing two product updates a week has different needs from a team answering customer messages all day. Write down your channels, post formats, and who reviews the content. Compare tools against that list before comparing plan names.",
        items: [
          "Mostly scheduling finished posts: try the queue, calendar, and per-channel preview in Buffer.",
          "Creating content from product work: evaluate OpenPost's composer, media tools, and separate versions for each destination.",
          "Running the service on your own infrastructure: compare OpenPost and Postiz, including maintenance and provider setup.",
        ],
      },
      {
        title: "Try one real product update",
        text: "Use the same source text and image in each candidate. Prepare the versions you would actually publish, adjust one destination, and check that the other versions stay intact. Then inspect the schedule, failure reporting, and results your account can retrieve. A feature list cannot answer those questions for you.",
      },
      {
        title: "Compare the total cost",
        text: "Count the accounts and people you need, then check current plan limits. For self-hosting, include the server, backups, media storage, provider access, and your maintenance time. Source access does not make operation free.",
      },
    ],
    sources: [
      {
        label: "Buffer scheduling documentation",
        href: "https://support.buffer.com/en-us/articles/scheduling-posts-4Qdld7giAZ",
      },
      {
        label: "Postiz introduction",
        href: "https://docs.postiz.com/general/introduction",
      },
    ],
    next: { label: "Explore OpenPost features", href: "/features" },
  },
  {
    slug: "turn-product-updates-into-social-media-posts",
    question: "How do I turn product updates into social media posts?",
    answer:
      "Start with a concrete change, explain who it helps, and show the result. Keep one source draft, then adapt its length, opening, media, and call to action for each destination. OpenPost keeps those versions in one Publication; AI can help draft them, but you review the facts and final copy.",
    sections: [
      {
        title: "Write down the evidence first",
        text: "Collect what changed, who can use it, where they find it, and any limits. Add a screenshot or short recording that demonstrates the change. This gives both you and a writing assistant something specific to work from.",
      },
      {
        title: "Turn a release note into a useful post",
        text: "Suppose your product now exports invoices as CSV. A useful source draft is: 'You can now export invoices as CSV from Billing. Choose a date range, download the file, and open it in your spreadsheet. Available to workspace admins.' That tells the reader what changed without inventing time savings or customer results.",
        items: [
          'Short post: "Invoice CSV export is here. Workspace admins can choose a date range in Billing and download a file for their spreadsheet."',
          'LinkedIn draft: "Need your invoice data in a spreadsheet? Workspace admins can now export a CSV from Billing. Select a date range, download the file, and open it in your spreadsheet. The screenshot shows where to find the export."',
          "For a video, record the export and make the output readable.",
          "Check every version for access restrictions, factual accuracy, and a working link.",
        ],
      },
      {
        title: "Keep the versions attached to the same idea",
        text: "In OpenPost, a Publication holds the source idea and its destination-specific Renditions. Each Rendition can have its own text, media, format, and timing. Start in the composer, select the accounts, and review each destination before scheduling. Buffer's AI Assistant is another option to compare for rewriting and adapting existing text.",
      },
    ],
    sources: [
      {
        label: "OpenPost product and workflow",
        href: "https://github.com/getopenpost/openpost/blob/main/PRODUCT.md",
      },
      { label: "Buffer AI Assistant", href: "https://buffer.com/ai-assistant" },
    ],
    next: { label: "See the content workflow", href: "/features" },
  },
  {
    slug: "schedule-social-media-posts-on-multiple-platforms",
    question: "How do I schedule social media posts on multiple platforms?",
    answer:
      "Use a scheduler that supports your exact accounts and formats. Connect the accounts, prepare a version for each destination, confirm the timezone, and schedule a small test. OpenPost models these as one Publication with separate Renditions, so text, media, and timing can differ without losing the shared source idea.",
    sections: [
      {
        title: "Check the account and format, not just the logo",
        text: "A tool listing Instagram does not establish that every Instagram account type or format works. Check the provider setup, account permissions, app review requirements, and whether the post can publish directly. Confirm these for every destination you plan to use.",
      },
      {
        title: "Prepare and inspect every destination",
        text: "Select the accounts in OpenPost's composer, write the shared draft, and then review each Rendition. Adjust text and media for that account. Choose the schedule and inspect any destination-specific timing before confirming.",
        items: [
          "Verify the timezone and calendar date, especially around daylight saving changes.",
          "Check media dimensions, duration, file size, and public URL requirements.",
          "Use a small test post before scheduling an important launch.",
          "After publication, inspect the actual provider post and the recorded outcome.",
        ],
      },
      {
        title: "Plan for partial failure",
        text: "One destination can fail while another publishes. Check which post exists on the provider before retrying so you do not create a duplicate. OpenPost exposes publishing and retry state; provider capabilities and readiness still vary. Buffer's scheduling guide documents its queue and custom-time workflow if you want another tool to compare.",
      },
    ],
    sources: [
      {
        label: "OpenPost provider readiness",
        href: "https://docs.openpo.st/operations/provider-launch-matrix",
      },
      {
        label: "Buffer scheduling documentation",
        href: "https://support.buffer.com/en-us/articles/scheduling-posts-4Qdld7giAZ",
      },
    ],
    next: { label: "Check platform support", href: "/platforms" },
  },
  {
    slug: "self-hosted-social-media-schedulers",
    question: "What social media schedulers can I self-host?",
    answer:
      "OpenPost and Postiz both offer self-hosting. OpenPost's default setup uses one container with SQLite and local media; PostgreSQL is also supported. Compare deployment requirements, provider configuration, backup procedures, and the formats you need. Self-hosting gives you control of the service, while social networks still control API access and publishing rules.",
    sections: [
      {
        title: "Compare operation before installation",
        text: "OpenPost embeds its web interface in a Go binary and uses database-backed publishing jobs. Its default self-hosted setup keeps the database and media local. Postiz documents a separate self-hosting path as well as its Hosted service. Read each project's current installation instructions before selecting infrastructure.",
      },
      {
        title: "You still need provider access",
        text: "Running the application does not grant permission to publish to a social network. You may need provider applications, OAuth configuration, approved permissions, and publicly accessible media. Check the requirements for each account and format you intend to use.",
      },
      {
        title: "Own the maintenance plan",
        text: "Before relying on scheduled posts, make sure you can restore the service after a failure.",
        items: [
          "Back up the database, media, and required configuration securely.",
          "Test a restore on a separate instance before you need it.",
          "Configure HTTPS and the public application and media URLs.",
          "Review the upgrade instructions and provider changes.",
          "Compare software license obligations and infrastructure costs with Hosted pricing.",
        ],
      },
    ],
    sources: [
      {
        label: "OpenPost installation",
        href: "https://docs.openpo.st/self-hosting/",
      },
      {
        label: "OpenPost source and license",
        href: "https://github.com/getopenpost/openpost",
      },
      {
        label: "Postiz introduction",
        href: "https://docs.postiz.com/general/introduction",
      },
    ],
    next: { label: "Compare Hosted and self-hosted", href: "/self-hosting" },
  },
  {
    slug: "social-media-tools-with-api-and-mcp",
    question: "Which social media tools have an API and MCP server?",
    answer:
      "OpenPost and Postiz document API, CLI, and MCP access. OpenPost uses the same posts, workspace permissions, and account boundaries across its app and automation interfaces. Choose based on the operations you need, authentication, supported destinations, and how you inspect failures, rather than the presence of an MCP badge.",
    sections: [
      {
        title: "Choose the interface for the job",
        text: "Use an HTTP API for an application integration, a CLI for scripts and terminal work, and MCP when your assistant supports connecting to that server. These are ways to operate the publishing service; they do not remove social-network permissions or format limits.",
      },
      {
        title: "Test the complete operation",
        text: "A useful evaluation starts with a draft and ends with an inspectable result. In OpenPost, review the API or MCP documentation for authentication and supported operations, choose the intended workspace and account, create a draft, and inspect it in the app before allowing publication.",
        items: [
          "Can the integration access only the intended workspace and accounts?",
          "Can you inspect and edit the draft before it publishes?",
          "Can you retrieve the final state and understand provider failures?",
          "Can you revoke access without sharing social account passwords?",
        ],
      },
      {
        title: "Keep publication deliberate",
        text: "Give an automation only the access its job requires. Start with a draft-producing workflow, review the destination and timing, and enable publishing only when you have tested it. Neither API nor MCP access proves that a particular provider is ready for your account.",
      },
    ],
    sources: [
      {
        label: "OpenPost API reference",
        href: "https://docs.openpo.st/development/api-reference",
      },
      { label: "OpenPost MCP guide", href: "https://docs.openpo.st/mcp/" },
      {
        label: "Postiz introduction",
        href: "https://docs.postiz.com/general/introduction",
      },
    ],
    next: { label: "Explore OpenPost automation", href: "/developers" },
  },
];
