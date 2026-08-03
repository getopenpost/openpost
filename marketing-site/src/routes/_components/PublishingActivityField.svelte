<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import PlatformIcon from "$lib/components/platform-icon.svelte";

  const platforms = ["x", "linkedin", "bluesky", "instagram", "youtube", "threads"] as const;
  const cells = Array.from({ length: platforms.length * 52 }, (_, index) => {
    const row = Math.floor(index / 52);
    const week = index % 52;
    if (week < 7 || (week + row * 5) % 11 === 0) return 0;
    const cadence = (week * 7 + row * 13) % 10;
    if (cadence > 7) return 4;
    if (cadence > 4) return 3;
    if (cadence > 1) return 2;
    return 1;
  });

  const activate: Attachment<HTMLElement> = (node) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.dataset.active = "true";
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        node.dataset.active = "true";
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  };
</script>

<div class="activity-frame" {@attach activate}>
  <div class="activity-topline">
    <span>Illustrative publishing activity</span>
    <span class="activity-key"><i></i><i></i><i></i><i></i> more posts</span>
  </div>
  <div class="activity-scroll">
    <div class="activity-rows" role="img" aria-label="Illustrative year of publishing activity across six social platforms">
      {#each platforms as platform, row (platform)}
        <div class="activity-row">
          <span class="activity-label"><PlatformIcon {platform} class="size-3.5" />{platform}</span>
          <div class="activity-cells">
            {#each cells.slice(row * 52, row * 52 + 52) as level, column (`${platform}-${column}`)}
              <i
                class:level-1={level === 1}
                class:level-2={level === 2}
                class:level-3={level === 3}
                class:level-4={level === 4}
                style:--cell-delay={`${column * 13 + row * 35}ms`}
              ></i>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
  <div class="activity-foot">
    <span>52 weeks</span>
    <span>one square per platform, per week</span>
  </div>
</div>

<style>
  .activity-frame {
    --cell-0: color-mix(in oklch, var(--muted) 68%, var(--background));
    --cell-1: oklch(0.83 0.055 63);
    --cell-2: oklch(0.73 0.105 54);
    --cell-3: oklch(0.64 0.145 47);
    --cell-4: oklch(0.55 0.17 42);
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--card);
  }

  .activity-topline,
  .activity-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.9rem 1rem;
    color: var(--muted-foreground);
    font-size: 0.72rem;
  }

  .activity-topline {
    border-bottom: 1px solid var(--border);
  }

  .activity-foot {
    border-top: 1px solid var(--border);
  }

  .activity-key {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .activity-key i,
  .activity-cells i {
    border-radius: 0.2rem;
  }

  .activity-key i {
    width: 0.55rem;
    height: 0.55rem;
  }

  .activity-key i:nth-child(1) { background: var(--cell-1); }
  .activity-key i:nth-child(2) { background: var(--cell-2); }
  .activity-key i:nth-child(3) { background: var(--cell-3); }
  .activity-key i:nth-child(4) { background: var(--cell-4); }

  .activity-scroll {
    overflow-x: auto;
    padding: 1.15rem 1rem;
  }

  .activity-rows {
    min-width: 43rem;
  }

  .activity-row {
    display: grid;
    grid-template-columns: 5.5rem 1fr;
    align-items: center;
    gap: 0.75rem;
  }

  .activity-row + .activity-row {
    margin-top: 0.32rem;
  }

  .activity-label {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.4rem;
    color: var(--muted-foreground);
    font-size: 0.7rem;
    text-transform: capitalize;
  }

  .activity-cells {
    display: grid;
    grid-template-columns: repeat(52, minmax(0, 1fr));
    gap: 0.22rem;
  }

  .activity-cells i {
    aspect-ratio: 1;
    background: var(--cell-0);
    opacity: 0.45;
    transform: scale(0.65);
  }

  [data-active="true"] .activity-cells i {
    opacity: 1;
    transform: scale(1);
    transition:
      opacity 480ms cubic-bezier(0.16, 1, 0.3, 1),
      transform 520ms cubic-bezier(0.16, 1, 0.3, 1);
    transition-delay: var(--cell-delay);
  }

  .activity-cells i.level-1 { background: var(--cell-1); }
  .activity-cells i.level-2 { background: var(--cell-2); }
  .activity-cells i.level-3 { background: var(--cell-3); }
  .activity-cells i.level-4 { background: var(--cell-4); }

  @media (max-width: 39.99rem) {
    .activity-key { display: none; }
    .activity-foot { align-items: flex-start; flex-direction: column; gap: 0.2rem; }
  }

  @media (prefers-reduced-motion: reduce) {
    .activity-cells i {
      opacity: 1;
      transform: none;
      transition: none;
    }
  }
</style>
