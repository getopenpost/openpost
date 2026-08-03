<script lang="ts">
  import type { PreviewModel } from "./model";
  import VerticalPreview from "./VerticalPreview.svelte";

  interface Props {
    model: PreviewModel;
    compact?: boolean;
  }

  let { model, compact = false }: Props = $props();
</script>

<VerticalPreview {model} platform="tiktok" {compact} />
