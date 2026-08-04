<script lang="ts">
  import {
    ArrowRight,
    Check,
    Images,
    MonitorSmartphone,
    Palette,
    ShieldCheck,
  } from "lucide-svelte";
  import { appUrl } from "../../_marketing";

  const imageEditorURL = `${appUrl}/image-editor?utm_source=openpost.social&utm_medium=free-tool&utm_campaign=public-image-editor`;
  const formats = [
    { label: "Square post", size: "1080 × 1080", ratio: "1 / 1" },
    { label: "Portrait post", size: "1080 × 1350", ratio: "4 / 5" },
    { label: "Story or Reel", size: "1080 × 1920", ratio: "9 / 16" },
    { label: "Video thumbnail", size: "1280 × 720", ratio: "16 / 9" },
  ];
</script>

<div class="bg-card mt-8 overflow-hidden rounded-xl border">
  <div class="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(30rem,1.1fr)]">
    <section
      class="flex flex-col p-5 sm:p-8 lg:p-10"
      aria-labelledby="image-editor-launch-title"
    >
      <div
        class="bg-background text-primary flex size-11 items-center justify-center rounded-xl border"
      >
        <Palette class="size-5" />
      </div>
      <h2 id="image-editor-launch-title" class="mt-5 text-2xl font-semibold">
        Start with a format, image, or template
      </h2>
      <p class="text-muted-foreground mt-3 max-w-xl leading-7">
        The tool opens in OpenPost Image Editor. Layer controls, text, shapes, image
        adjustments, page ordering, and PNG, JPEG, or WebP export are ready
        without an account.
      </p>

      <ul
        class="mt-6 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"
      >
        <li class="flex items-center gap-2">
          <Check class="text-primary size-4" /> No watermark
        </li>
        <li class="flex items-center gap-2">
          <ShieldCheck class="text-primary size-4" /> Local browser storage
        </li>
        <li class="flex items-center gap-2">
          <Images class="text-primary size-4" /> Multi-page designs
        </li>
        <li class="flex items-center gap-2">
          <MonitorSmartphone class="text-primary size-4" /> Desktop and mobile
        </li>
      </ul>

      <a
        href={imageEditorURL}
        data-umami-event="public-image-editor-open"
        data-umami-event-source="marketing-tool"
        class="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring mt-8 inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-lg px-5 font-medium transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        Open the free editor
        <ArrowRight class="size-4" />
      </a>
      <p class="text-muted-foreground mt-3 text-xs leading-5">
        Local work stays on this device. You can move a design to an OpenPost
        workspace later.
      </p>
    </section>

    <section
      class="border-t bg-neutral-950 p-5 text-neutral-100 sm:p-8 lg:border-t-0 lg:border-l"
      aria-label="Available social media formats"
    >
      <div class="flex items-center justify-between gap-4">
        <div>
          <p
            class="text-xs font-medium tracking-wide text-orange-300 uppercase"
          >
            OpenPost Image Editor
          </p>
          <h2 class="mt-1 text-lg font-semibold">Choose a canvas</h2>
        </div>
        <span
          class="rounded-full border border-white/15 px-2.5 py-1 text-xs text-neutral-300"
          >Saved locally</span
        >
      </div>
      <div class="mt-6 grid grid-cols-2 gap-3">
        {#each formats as format (format.label)}
          <div class="rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <div class="grid h-28 place-items-center rounded-md bg-neutral-900">
              <div
                class="max-h-20 max-w-28 bg-orange-50 shadow-lg"
                style:aspect-ratio={format.ratio}
                style:height={format.ratio === "9 / 16" ? "5rem" : "auto"}
                style:width={format.ratio === "9 / 16" ? "auto" : "7rem"}
              ></div>
            </div>
            <p class="mt-3 text-sm font-medium">{format.label}</p>
            <p class="mt-0.5 text-xs text-neutral-400">{format.size}</p>
          </div>
        {/each}
      </div>
    </section>
  </div>
</div>
