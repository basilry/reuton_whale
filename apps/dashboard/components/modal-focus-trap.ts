"use client";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function isVisible(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute("aria-hidden") === "true") {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

export function getModalFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute("disabled") && isVisible(element),
  );
}

export function focusModalFallback(
  container: HTMLElement | null,
  fallback: HTMLElement | null | undefined,
): void {
  const [first] = getModalFocusableElements(container);
  if (first) {
    first.focus();
    return;
  }

  if (fallback) {
    fallback.focus();
    return;
  }

  container?.focus();
}

export function trapModalKeydown(
  event: KeyboardEvent,
  container: HTMLElement | null,
  fallback: HTMLElement | null | undefined,
  onClose: () => void,
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }

  if (event.key !== "Tab") {
    return;
  }

  const focusable = getModalFocusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    focusModalFallback(container, fallback);
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  if (event.shiftKey) {
    if (!activeElement || activeElement === first || !container?.contains(activeElement)) {
      event.preventDefault();
      last.focus();
    }
    return;
  }

  if (!activeElement || activeElement === last || !container?.contains(activeElement)) {
    event.preventDefault();
    first.focus();
  }
}
