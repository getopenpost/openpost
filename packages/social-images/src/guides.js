// Shared by the route manifest and the rendered guides so titles and answers stay together.
export const marketingGuides = [
  {
    slug: "best-social-media-tools-for-solo-founders",
    question: "What are the best social media tools for solo founders?",
    socialDescription:
      "Compare Buffer, OpenPost, and Postiz against your publishing workflow, account needs, plan limits, and self-hosting costs.",
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
    next: { label: "Explore OpenPost features", href: "/#features" },
  },
  {
    slug: "turn-product-updates-into-social-media-posts",
    question: "How do I turn product updates into social media posts?",
    socialDescription:
      "Turn one verified product update into destination-specific social posts, with separate text, media, and calls to action.",
    answer:
      "Start with a concrete change, explain who it helps, and show the result. Keep one source draft, then adapt its length, opening, media, and call to action for each destination. OpenPost keeps those versions together. AI can help with a draft, and you choose the final words.",
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
        text: "Start a draft in OpenPost, choose your accounts, and adjust the words and images for each channel. Your versions stay together, so you can return to the same idea without searching through several apps. Buffer's AI Assistant is another option to compare for rewriting and adapting existing text.",
      },
    ],
    sources: [
      {
        label: "OpenPost product and workflow",
        href: "https://github.com/getopenpost/openpost/blob/main/PRODUCT.md",
      },
      { label: "Buffer AI Assistant", href: "https://buffer.com/ai-assistant" },
    ],
    next: { label: "See the content workflow", href: "/#features" },
  },
  {
    slug: "schedule-social-media-posts-on-multiple-platforms",
    question: "How do I schedule social media posts on multiple platforms?",
    socialDescription:
      "Schedule one source idea across several platforms while checking account permissions, media rules, timezones, and partial failures.",
    answer:
      "Use a scheduler that supports your exact accounts and formats. Connect the accounts, prepare a version for each destination, confirm the timezone, and schedule a small test. OpenPost keeps the drafts together while letting you change the text, media, and timing for each channel.",
    sections: [
      {
        title: "Check the account and format, not just the logo",
        text: "A tool listing Instagram does not establish that every Instagram account type or format works. Check the account requirements and whether your chosen post can publish directly. Confirm these for every destination you plan to use.",
      },
      {
        title: "Prepare and inspect every destination",
        text: "Select the accounts in OpenPost's composer, write the shared draft, and then review each version. Adjust text and media for that account. Choose the schedule and inspect any destination-specific timing before confirming.",
        items: [
          "Verify the timezone and calendar date, especially around daylight saving changes.",
          "Check that your images and videos fit the channel.",
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
        href: "https://docs.openpo.st/self-hosting/maintenance",
      },
      {
        label: "Buffer scheduling documentation",
        href: "https://support.buffer.com/en-us/articles/scheduling-posts-4Qdld7giAZ",
      },
    ],
    next: { label: "Check platform support", href: "/platforms" },
  },
];
