export const marketingErrorRecovery = {
  status: 404,
  label: "Page not found",
  title: "This route does not lead to an OpenPost page.",
  description:
    "The address may be old, incomplete, or mistyped. Use one of the maintained paths below to keep going.",
  primary: { label: "Go to OpenPost home", href: "/" },
  routes: [
    {
      label: "Explore features",
      description:
        "See the complete publishing workflow and its current limits.",
      href: "/features",
    },
    {
      label: "Read the FAQ",
      description:
        "Check setup, providers, billing, privacy, and self-hosting.",
      href: "/faq",
    },
    {
      label: "Open user docs",
      description: "Follow maintained product and setup guidance.",
      href: "https://docs.openpost.social/usage/",
    },
  ],
  support: [
    { label: "Email support", href: "mailto:openpost@rgo.pt" },
    {
      label: "Ask the Discord community",
      href: "https://discord.gg/u2QwukmY4W",
    },
  ],
} as const;
