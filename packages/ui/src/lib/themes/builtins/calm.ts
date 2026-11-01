import type { ThemeScheme } from "../contracts.js";
import { colors, familyTypography, scheme, theme } from "./shared.js";

const accentHue = 45;
const neutralHue = 80;

function calmScheme(appearance: ThemeScheme) {
  const dark = appearance === "dark";
  const ink = dark ? `oklch(0.95 0.004 ${neutralHue})` : `oklch(0.24 0.008 ${neutralHue})`;
  const mutedInk = dark ? `oklch(0.75 0.007 ${neutralHue})` : `oklch(0.47 0.01 ${neutralHue})`;
  const canvas = dark ? `oklch(0.175 0.005 ${neutralHue})` : `oklch(0.993 0.0015 ${neutralHue})`;
  const surface = dark ? `oklch(0.205 0.005 ${neutralHue})` : "oklch(1 0 0)";
  const raised = dark ? `oklch(0.235 0.006 ${neutralHue})` : "oklch(1 0 0)";
  const sunken = dark ? `oklch(0.15 0.005 ${neutralHue})` : `oklch(0.972 0.003 ${neutralHue})`;
  const border = dark ? `oklch(0.3 0.006 ${neutralHue})` : `oklch(0.915 0.004 ${neutralHue})`;
  const fieldBorder = dark ? `oklch(0.42 0.007 ${neutralHue})` : `oklch(0.8 0.006 ${neutralHue})`;
  const accent = dark ? `oklch(0.76 0.115 ${accentHue})` : `oklch(0.53 0.135 ${accentHue})`;
  const accentInk = dark ? `oklch(0.17 0.02 ${accentHue})` : "oklch(0.995 0.002 85)";
  const accentHover = dark ? `oklch(0.82 0.1 ${accentHue})` : `oklch(0.48 0.13 ${accentHue})`;
  const accentActive = dark ? `oklch(0.87 0.08 ${accentHue})` : `oklch(0.44 0.12 ${accentHue})`;
  const selection = dark ? `oklch(0.29 0.03 ${accentHue})` : `oklch(0.95 0.018 ${accentHue})`;
  const navigationActive = dark
    ? `oklch(0.26 0.006 ${neutralHue})`
    : `oklch(0.935 0.005 ${neutralHue})`;
  const dangerFill = dark ? "oklch(0.35 0.1 25)" : "oklch(0.53 0.19 25)";

  return scheme(
    {
      colors: colors({
        canvas,
        ink,
        surface,
        surfaceRaised: raised,
        surfaceSunken: sunken,
        mutedInk,
        border,
        input: fieldBorder,
        fieldBorder,
        focus: dark ? `oklch(0.8 0.11 ${accentHue})` : `oklch(0.46 0.125 ${accentHue})`,
        caret: accent,
        link: dark ? `oklch(0.8 0.1 ${accentHue})` : `oklch(0.47 0.125 ${accentHue})`,
        selection,
        selectionInk: ink,
        actionFocal: accent,
        actionFocalInk: accentInk,
        actionFocalHover: accentHover,
        actionFocalActive: accentActive,
        actionPrimary: accent,
        actionPrimaryInk: accentInk,
        actionPrimaryHover: accentHover,
        actionPrimaryActive: accentActive,
        actionOrdinary: surface,
        actionOrdinaryInk: ink,
        actionOrdinaryBorder: fieldBorder,
        actionOrdinaryHover: sunken,
        actionOrdinaryActive: navigationActive,
        danger: dark ? "oklch(0.66 0.19 25)" : "oklch(0.53 0.19 25)",
        dangerInk: dark ? "oklch(0.12 0.01 50)" : "oklch(0.99 0 0)",
        actionDestructive: `color-mix(in oklch, ${dangerFill} 12%, transparent)`,
        actionDestructiveHover: `color-mix(in oklch, ${dangerFill} 20%, transparent)`,
        actionDestructiveActive: `color-mix(in oklch, ${dangerFill} 28%, transparent)`,
        actionDestructiveInk: dark ? "oklch(0.83 0.12 25)" : "oklch(0.43 0.18 25)",
        success: dark ? "oklch(0.27 0.05 155)" : "oklch(0.95 0.03 155)",
        successInk: dark ? "oklch(0.82 0.11 155)" : "oklch(0.37 0.09 155)",
        warning: dark ? "oklch(0.28 0.05 85)" : "oklch(0.96 0.04 85)",
        warningInk: dark ? "oklch(0.86 0.11 85)" : "oklch(0.42 0.09 75)",
        info: dark ? "oklch(0.27 0.05 255)" : "oklch(0.95 0.025 255)",
        infoInk: dark ? "oklch(0.83 0.1 255)" : "oklch(0.42 0.13 255)",
        sidebar: sunken,
        sidebarInk: ink,
        sidebarActive: navigationActive,
        sidebarActiveInk: ink,
        navigationHover: navigationActive,
        navigationActive,
        navigationActiveInk: ink,
        chart1: dark ? "oklch(0.74 0.14 45)" : "oklch(0.55 0.15 45)",
        chart2: dark ? "oklch(0.76 0.12 165)" : "oklch(0.54 0.11 165)",
        chart3: dark ? "oklch(0.75 0.13 250)" : "oklch(0.55 0.14 250)",
        chart4: dark ? "oklch(0.78 0.12 310)" : "oklch(0.58 0.13 310)",
        chart5: dark ? "oklch(0.82 0.12 85)" : "oklch(0.64 0.12 85)",
      }),
      typography: {
        ...familyTypography("manrope", {
          titleTracking: "-0.02em",
        }),
      },
      spacing: { sectionGap: "1.75rem", componentGap: "0.875rem" },
      shape: {
        radius: "0.625rem",
        radiusSm: "0.375rem",
        radiusMd: "0.5rem",
        radiusLg: "0.75rem",
        radiusMedia: "0.75rem",
      },
      elevation: { card: "none", focalAction: "none" },
      shell: { contentMaxWidth: "68rem", sidebarWidth: "15rem" },
      components: {
        button: "solid",
        card: "outlined",
        navigation: "quiet",
        tabs: "underline",
        input: "outlined",
        select: "outlined",
        badge: "tonal",
        toolbar: "flat",
        decoration: "none",
      },
    },
    appearance,
  );
}

export const calmTheme = theme(
  "calm",
  "Calm",
  "Near-white paper, soft dividers, and one warm accent for what matters.",
  "lucide",
  { light: calmScheme("light"), dark: calmScheme("dark") },
);
