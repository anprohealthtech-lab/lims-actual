import { useEffect, useRef } from "react";

let nextEscapeModalId = 1;
const openEscapeModalStack: number[] = [];

const removeModalFromStack = (id: number) => {
  const index = openEscapeModalStack.lastIndexOf(id);
  if (index !== -1) {
    openEscapeModalStack.splice(index, 1);
  }
};

export const useEscapeModalClose = (onClose: () => void, enabled = true) => {
  const modalIdRef = useRef<number | null>(null);

  if (modalIdRef.current === null) {
    modalIdRef.current = nextEscapeModalId++;
  }

  useEffect(() => {
    if (!enabled) {
      removeModalFromStack(modalIdRef.current!);
      return;
    }

    const modalId = modalIdRef.current!;
    removeModalFromStack(modalId);
    openEscapeModalStack.push(modalId);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openEscapeModalStack[openEscapeModalStack.length - 1] !== modalId) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      onClose();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      removeModalFromStack(modalId);
    };
  }, [enabled, onClose]);
};
