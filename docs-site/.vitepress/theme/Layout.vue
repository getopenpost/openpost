<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import TelemetryConsent from "./TelemetryConsent.vue";
</script>

<template>
  <DefaultTheme.Layout>
    <template #layout-bottom>
      <TelemetryConsent />
    </template>
  </DefaultTheme.Layout>
</template>
