# Copilot Instructions

## Design Context

### Users
Solo creators, indie hackers, social media managers, and small teams who need to schedule and publish content across multiple social platforms. They range from technical (developers self-hosting) to non-technical (content creators). They use OpenPost at their desk during focused work sessions, but also on mobile for quick checks. Their primary job is publishing content efficiently — the tool should feel fast and stay out of the way.

### Brand Personality
**Focused. Efficient. Clean.** OpenPost is the tool that respects your time. It's sharp without being cold, capable without being complicated. Think well-maintained workshop, not corporate dashboard. Directness over decoration. Precision over polish.

### Aesthetic Direction
**Technical Minimal** — Crisp, precise, monospace accents, dark/light equally supported. Inspired by well-crafted developer tools refined for everyday use. Strong grid discipline, restrained color, typography that earns its weight. Dark mode should feel native, not bolted on.

- **Theme**: Both dark and light modes, equally supported. System preference respected.
- **Anti-references**: No corporate dashboard aesthetics, no bubbly startup vibes, no Typefully-style editorial whimsy.
- **Current state**: UI uses shadcn/svelte components with Inter Variable font and oklch-based color system. The foundation is solid but generic — needs intentional differentiation.

### Design Principles

1. **Get out of the way** — The interface should disappear into the task. Every element earns its pixel. If it doesn't help publish content, it doesn't belong.
2. **Precision in restraint** — Monospace for data and labels, humanist for content. Tight spacing, deliberate alignment. Like a well-set terminal that's actually pleasant to read.
3. **Information density without clutter** — Show what matters, hide what doesn't. The dashboard should feel like a cockpit, not a brochure. Dense but scannable.
4. **Monochrome confidence** — Restrained palette built around warm neutrals (the existing oklch warm hue at ~48-58). One sharp accent for actions. Color is a signal, never decoration.
5. **Consistency as trust** — Predictable patterns across pages. Platform icons and badges always work the same way. State changes are visible but never jarring.