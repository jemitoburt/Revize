import { useRef, type PointerEvent } from 'react';

/** How far a press may slide and still count as a tap (Apple Pencil taps move a little). */
const TAP_SLOP_PX = 24;

/**
 * Activation on pointer up instead of click, for keys tapped quickly one after another.
 *
 * Safari on iPad drops the click of an Apple Pencil tap that moved a few pixels and treats two
 * quick taps as a double tap, so keys of the number pad did not react to the Pencil. The press
 * fires on pointer up (finger, Pencil, mouse); the click that may follow is ignored, and a click
 * without a pointer (keyboard, assistive technology) still works.
 */
export function usePress(onPress: () => void) {
  const down = useRef<{ x: number; y: number } | null>(null);
  const pressedAt = useRef(0);
  return {
    onPointerDown: (event: PointerEvent) => {
      down.current = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    },
    onPointerUp: (event: PointerEvent) => {
      const start = down.current;
      down.current = null;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX) return;
      pressedAt.current = Date.now();
      onPress();
    },
    onPointerCancel: () => {
      down.current = null;
    },
    onClick: () => {
      if (Date.now() - pressedAt.current < 800) return;
      onPress();
    },
  };
}
