"use client";

import { RefObject, useEffect, useLayoutEffect } from "react";

// layout effect on the client (measure before paint, so the panel never shows
// up at the fallback offset first), plain effect on the server render
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const MARGIN = 12; // keep this much of the viewport either side of the panel

// The header dropdowns hang off small icon buttons that, once the top bar wraps
// on a phone, sit near the *left* edge — so a 320px panel anchored to the
// button's right edge opens off-screen. Under 800px the panel is pinned to the
// viewport instead (see globals.css) and this places it: still tucked under its
// trigger, but nudged back inside whenever that would hang it over an edge.
export default function usePanelAnchor<T extends HTMLElement>(open: boolean, ref: RefObject<T | null>) {
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const place = () => {
      const trigger = el.getBoundingClientRect();
      const width = el.querySelector<HTMLElement>(".status-panel")?.offsetWidth ?? 0;
      const right = Math.min(trigger.right, window.innerWidth - MARGIN);
      el.style.setProperty("--panel-top", `${Math.round(trigger.bottom + 8)}px`);
      el.style.setProperty("--panel-left", `${Math.round(Math.max(MARGIN, right - width))}px`);
    };
    place();
    // the bar is sticky, but iOS moves it around as its browser chrome collapses
    window.addEventListener("resize", place);
    window.addEventListener("orientationchange", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("orientationchange", place);
      window.removeEventListener("scroll", place);
    };
  }, [open, ref]);
}
