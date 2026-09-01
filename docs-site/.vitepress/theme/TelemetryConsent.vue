<script setup lang="ts">
import {
  setTelemetryPreference,
  subscribeTelemetryPreference,
  telemetryPreferencesEvent,
  type TelemetryPreference,
  type TelemetryPreferenceStatus,
} from "@openpost/telemetry";
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";

const preference = ref<TelemetryPreferenceStatus>("unavailable");
const preferencesOpen = ref(false);
const heading = ref<HTMLHeadingElement>();
const visible = computed(() => preference.value === "undecided" || preferencesOpen.value);
let unsubscribe = () => undefined;

async function openPreferences() {
  preferencesOpen.value = true;
  await nextTick();
  heading.value?.focus();
}

function choose(next: TelemetryPreference) {
  setTelemetryPreference(next);
  preferencesOpen.value = false;
}

function handleDocumentClick(event: MouseEvent) {
  if (!(event.target instanceof Element) || !event.target.closest("[data-openpost-analytics]"))
    return;
  void openPreferences();
}

onMounted(() => {
  unsubscribe = subscribeTelemetryPreference((next) => (preference.value = next));
  window.addEventListener(telemetryPreferencesEvent, openPreferences);
  document.addEventListener("click", handleDocumentClick);
});

onUnmounted(() => {
  unsubscribe();
  window.removeEventListener(telemetryPreferencesEvent, openPreferences);
  document.removeEventListener("click", handleDocumentClick);
});
</script>

<template>
  <section
    v-if="visible"
    class="op-telemetry-consent"
    aria-labelledby="op-telemetry-consent-title"
    :aria-live="preference === 'undecided' ? 'polite' : 'off'"
  >
    <div class="op-telemetry-copy">
      <div>
        <h2 id="op-telemetry-consent-title" ref="heading" tabindex="-1">Analytics choices</h2>
        <p>
          Allow first-party analytics cookies to connect visits and show what works. Without
          cookies, OpenPost counts limited anonymous activity. We never use ads, session replay, or
          broad click tracking.
        </p>
      </div>
      <button
        v-if="preference !== 'undecided'"
        type="button"
        class="op-telemetry-close"
        @click="preferencesOpen = false"
      >
        Close
      </button>
    </div>
    <div class="op-telemetry-actions">
      <button
        type="button"
        :aria-pressed="preference === 'persistent'"
        @click="choose('persistent')"
      >
        Allow analytics cookies
      </button>
      <button
        type="button"
        :aria-pressed="preference === 'cookieless'"
        @click="choose('cookieless')"
      >
        Continue without cookies
      </button>
      <button
        type="button"
        class="op-telemetry-quiet"
        :aria-pressed="preference === 'off'"
        @click="choose('off')"
      >
        Turn off optional analytics
      </button>
      <a href="https://openpo.st/privacy">Privacy policy</a>
    </div>
  </section>
</template>
