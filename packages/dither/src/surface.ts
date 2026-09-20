import { DITHER_CELL_SIZE, gradientMask, type GradientOptions } from "./paint";

export interface SurfaceOptions extends Pick<GradientOptions, "direction" | "kind"> {
  interactive?: boolean;
}

/** DOM lifecycle shared by Svelte actions and React effects. No frames run once settled. */
export function ditherSurface(node: HTMLElement | SVGElement, initial: SurfaceOptions = {}) {
  let options = initial;
  let length = 0;
  let intensity = 0;
  let target = 0;
  let frame = 0;
  let previousTime = 0;
  let hovered = false;
  let pressed = false;
  const interaction = node.closest<HTMLElement | SVGElement>("[data-dither-interaction]") ?? node;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const hover = matchMedia("(hover: hover)");
  const disabled = () => node.matches(':disabled, [aria-disabled="true"]');
  const paint = () => {
    if (!length) return;
    node.style.setProperty("--dither-mask", gradientMask({ ...options, length, intensity }));
  };
  const tick = (time: number) => {
    const elapsed = previousTime ? Math.min(time - previousTime, 64) : 16;
    previousTime = time;
    intensity += (target - intensity) * (1 - Math.exp(-elapsed / 60));
    if (Math.abs(target - intensity) < 0.01) intensity = target;
    paint();
    frame = intensity === target ? 0 : requestAnimationFrame(tick);
  };
  const settle = () => {
    const enabled =
      options.interactive &&
      !disabled() &&
      getComputedStyle(node).getPropertyValue("--dither-enabled").trim() === "1";
    target = enabled
      ? pressed
        ? 1.5
        : hovered || interaction.matches(":focus-visible")
          ? 1
          : 0
      : 0;
    if (reduced.matches) {
      cancelAnimationFrame(frame);
      frame = 0;
      intensity = target;
      paint();
    } else if (!frame && intensity !== target) {
      previousTime = 0;
      frame = requestAnimationFrame(tick);
    }
  };
  const resize = () => {
    const box = node.getBoundingClientRect();
    const horizontal = options.direction === "left" || options.direction === "right";
    length = Math.ceil(horizontal ? box.width : box.height);
    const extent = Math.ceil(length / DITHER_CELL_SIZE) * DITHER_CELL_SIZE;
    const transform =
      node instanceof SVGGraphicsElement && node.ownerSVGElement ? node.getScreenCTM() : null;
    const scaleX = transform ? Math.hypot(transform.a, transform.b) || 1 : 1;
    const scaleY = transform ? Math.hypot(transform.c, transform.d) || 1 : 1;
    const width = (horizontal ? extent : DITHER_CELL_SIZE * 4) / scaleX;
    const height = (horizontal ? DITHER_CELL_SIZE * 4 : extent) / scaleY;
    node.style.setProperty("--dither-mask-size", `${width}px ${height}px`);
    paint();
  };
  const enter = () => {
    hovered = hover.matches;
    settle();
  };
  const leave = () => {
    hovered = false;
    pressed = false;
    settle();
  };
  const down = () => {
    pressed = true;
    settle();
  };
  const up = () => {
    if (!pressed) return;
    pressed = false;
    settle();
  };
  const keydown = (event: Event) => {
    if (event instanceof KeyboardEvent && [" ", "Enter"].includes(event.key)) down();
  };
  const events: [string, EventListener][] = [
    ["pointerenter", enter],
    ["pointerleave", leave],
    ["pointerdown", down],
    ["pointercancel", leave],
    ["focus", settle],
    ["blur", leave],
    ["keydown", keydown],
  ];
  for (const [event, handler] of events) interaction.addEventListener(event, handler);
  window.addEventListener("pointerup", up);
  interaction.addEventListener("keyup", up);
  reduced.addEventListener("change", settle);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(node);
  const stateObserver = new MutationObserver(settle);
  stateObserver.observe(node, {
    attributes: true,
    attributeFilter: ["disabled", "aria-disabled"],
  });
  resize();
  return {
    update(next: SurfaceOptions) {
      options = next;
      resize();
      settle();
    },
    destroy() {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      stateObserver.disconnect();
      for (const [event, handler] of events) interaction.removeEventListener(event, handler);
      window.removeEventListener("pointerup", up);
      interaction.removeEventListener("keyup", up);
      reduced.removeEventListener("change", settle);
      node.style.removeProperty("--dither-mask");
      node.style.removeProperty("--dither-mask-size");
    },
  };
}
