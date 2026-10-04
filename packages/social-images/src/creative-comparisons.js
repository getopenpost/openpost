const freeEditorCosts = {
  title: "What is free in OpenPost",
  text: "OpenPost's local Image Editor and Video Editor are free without an account, watermark, or paid download. Media stays on your device in the local workflow. Hosted storage, account connections, and scheduled publishing are separate services with their own plans. A publishing subscription is not required to edit and export a local project.",
};

const editorSources = [
  { label: "OpenPost free editor scope", href: "https://github.com/getopenpost/openpost#readme" },
  { label: "OpenPost free tools", href: "https://openpo.st/tools" },
];

export const creativeComparisons = [
  {
    slug: "openpost-vs-photoshop",
    comparison: {
      name: "Photoshop",
      logo: "/assets/logos/comparisons/photoshop.svg",
      category: "Images",
      toolHref: "/tools/social-media-image-editor",
      toolLabel: "Try the free Image Editor",
    },
    reviewedAt: "2026-10-04",
    question: "OpenPost vs Photoshop: social images or deep photo editing?",
    socialDescription:
      "Compare a free browser editor for social images with Photoshop's advanced photo and compositing workflow.",
    answer:
      "Use OpenPost's free Image Editor for social graphics, carousel pages, and thumbnails in your browser. Choose Photoshop for precise selections, detailed retouching, and complex photo composites. OpenPost is a focused image tool, not a replacement for every Photoshop workflow.",
    sections: [
      {
        title: "When Photoshop is the better fit",
        text: "Photoshop provides advanced selections, masks, adjustment layers, and generative image editing. Keep it when detailed photo work or an established Photoshop handoff is part of the job. A simple social graphic and a layered photo composite need different levels of control.",
      },
      freeEditorCosts,
      {
        title: "Editing costs",
        text: "Adobe lists Photoshop for individuals at US$22.99/month with an annual commitment billed monthly. Region, taxes, bundles, and promotions can change the price. Photoshop also has a free mobile offering with paid features; the desktop subscription is the comparison here.",
        table: {
          caption: "Image editing costs",
          columns: ["Tool", "Cost", "Scope"],
          rows: [
            ["OpenPost local Image Editor", "$0", "Browser editing and export"],
            [
              "Photoshop desktop",
              "US$22.99/month, annual commitment",
              "Adobe individual subscription",
            ],
          ],
        },
      },
      {
        title: "When OpenPost is the better fit",
        text: "Use OpenPost when you need text, shapes, images, and reusable layouts for a post, without installing an app or starting a subscription. Work on several social pages and export the result. Do not assume Photoshop document interchange, print color workflows, or professional retouching parity.",
      },
      {
        title: "Try the actual image",
        text: "Make your next thumbnail in both tools. Check the text, source image, export dimensions, and any edit you expect to revisit. Choose the tool that finishes that job; keep Photoshop for work that needs its deeper controls.",
      },
    ],
    sources: [
      {
        label: "Photoshop features and individual pricing",
        href: "https://www.adobe.com/products/photoshop.html",
      },
      ...editorSources,
    ],
    next: { label: "Try the free Image Editor", href: "/tools/social-media-image-editor" },
  },
  {
    slug: "openpost-vs-davinci-resolve",
    comparison: {
      name: "DaVinci Resolve",
      logo: "/assets/logos/comparisons/davinci-resolve.png",
      category: "Video",
      toolHref: "/tools/social-media-video-editor",
      toolLabel: "Try the free Video Editor",
    },
    reviewedAt: "2026-10-04",
    question: "OpenPost vs DaVinci Resolve: browser clips or a full post studio?",
    socialDescription:
      "Compare two free editing options, local browser projects, color grading, effects, and professional audio.",
    answer:
      "Both have a free editing path. Use OpenPost for a product recording or social clip you want to finish in the browser. Choose DaVinci Resolve for a desktop workflow combining editing, advanced color work, Fusion effects, and Fairlight audio. Free does not mean the tools have the same scope.",
    sections: [
      {
        title: "When DaVinci Resolve is the better fit",
        text: "Resolve combines editing, color correction, visual effects, and audio post-production. Its free version supports many 8-bit formats up to 60 fps and Ultra HD. Studio adds further AI tools, effects, and format support. It is the stronger choice when finishing quality and specialized post-production are central to the job.",
      },
      freeEditorCosts,
      {
        title: "Editing costs",
        text: "Blackmagic offers DaVinci Resolve free and lists Studio at US$295. Studio is a purchase rather than the monthly subscription shown for Adobe products. Cloud collaboration and third-party assets may have separate costs.",
        table: {
          caption: "Video editing costs",
          columns: ["Tool", "Cost", "Scope"],
          rows: [
            ["OpenPost local Video Editor", "$0", "Browser recording, editing and export"],
            ["DaVinci Resolve", "$0", "Free desktop edition"],
            ["DaVinci Resolve Studio", "US$295 purchase", "Paid desktop edition"],
          ],
        },
      },
      {
        title: "When OpenPost is the better fit",
        text: "OpenPost brings recording and a multitrack timeline into your browser. Use it for demonstrations, short edits, captions, and social formats. Browser decoding and encoding depend on your device and supported codecs. It does not promise Fusion, Fairlight, professional grading, or Resolve project interchange.",
      },
      {
        title: "Test your source footage",
        text: "Import the camera or screen recording you actually use. Check playback, audio, captions, and the exported file. For long projects or demanding camera formats, test resource use and finish quality before choosing a browser editor.",
      },
    ],
    sources: [
      {
        label: "DaVinci Resolve editions, formats and price",
        href: "https://www.blackmagicdesign.com/products/davinciresolve",
      },
      ...editorSources,
    ],
    next: { label: "Try the free Video Editor", href: "/tools/social-media-video-editor" },
  },
  {
    slug: "openpost-vs-premiere-pro",
    comparison: {
      name: "Premiere Pro",
      logo: "/assets/logos/comparisons/premiere-pro.svg",
      category: "Video",
      toolHref: "/tools/social-media-video-editor",
      toolLabel: "Try the free Video Editor",
    },
    reviewedAt: "2026-10-04",
    question: "OpenPost vs Premiere Pro: quick social edits or professional production?",
    socialDescription:
      "Compare free browser editing with Adobe Premiere's desktop production, collaboration, and subscription.",
    answer:
      "Use OpenPost's free Video Editor to record and finish a social video in the browser. Choose Adobe Premiere, often called Premiere Pro, when your work needs its desktop editing tools, production integrations, and existing team workflow. Test the source footage and required handoff, not just the export price.",
    sections: [
      {
        title: "When Premiere Pro is the better fit",
        text: "Premiere offers text-based editing, advanced color and audio tools, effects, and Frame.io integration. Keep it for an established Adobe production pipeline or work that needs those controls. An export from a browser editor does not replace an editable Premiere project handoff.",
      },
      freeEditorCosts,
      {
        title: "Editing costs",
        text: "Adobe lists Premiere for new individual subscribers at US$22.99/month for the first year, with an annual commitment billed monthly. Check renewal rates, regional prices, taxes, and cancellation terms. A month-to-month plan or Creative Cloud bundle has different terms. Adobe also offers a free mobile editor; this comparison covers desktop Premiere.",
        table: {
          caption: "Video editing costs",
          columns: ["Tool", "Cost", "Scope"],
          rows: [
            ["OpenPost local Video Editor", "$0", "Browser recording, editing and export"],
            [
              "Adobe Premiere desktop",
              "US$22.99/month for new subscribers in year one, annual commitment",
              "Adobe individual subscription",
            ],
          ],
        },
      },
      {
        title: "When OpenPost is the better fit",
        text: "OpenPost suits a founder recording a feature walkthrough, trimming it, adding text or captions, and exporting a social version. No account or subscription is required for local projects. Codec and export support depend on the browser and device; professional format coverage and Adobe project compatibility are not promised.",
      },
      {
        title: "Check the complete handoff",
        text: "Edit one real clip and inspect the exported picture, sound, caption placement, and dimensions. If another editor needs the project rather than the finished video, keep the tool and format your team can reopen.",
      },
    ],
    sources: [
      {
        label: "Adobe Premiere features and individual pricing",
        href: "https://www.adobe.com/products/premiere.html",
      },
      ...editorSources,
    ],
    next: { label: "Try the free Video Editor", href: "/tools/social-media-video-editor" },
  },
];
