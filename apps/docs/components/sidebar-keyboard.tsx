"use client";

import { useEffect } from "react";
import { useSidebar } from "fumadocs-ui/components/sidebar/base";

export function SidebarKeyboard() {
  const { open, mode, setOpen } = useSidebar();
  useEffect(() => {
    if (!open || mode !== "drawer") return;
    function dismiss(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('#nd-sidebar-mobile, [aria-controls="nd-sidebar-mobile"]')) return;
      event.preventDefault();
      setOpen(false);
      document
        .querySelector<HTMLButtonElement>('button[aria-controls="nd-sidebar-mobile"]')
        ?.focus();
    }
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [open, mode, setOpen]);
  return null;
}
