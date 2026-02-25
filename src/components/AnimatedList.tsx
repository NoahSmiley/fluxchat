import { useEffect, useRef, useState } from "react";

/** Lightweight AnimatePresence: keeps exiting items in DOM for animation */
export function AnimatedList<T extends { key: string }>({
  items,
  renderItem,
  duration = 500,
}: {
  items: T[];
  renderItem: (item: T, state: "entering" | "exiting" | "idle") => React.ReactNode;
  duration?: number;
}) {
  const renderedRef = useRef<(T & { _exiting?: boolean })[]>(items);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const enteringRef = useRef<Set<string>>(new Set());
  const prevKeysRef = useRef<string>(items.map((i) => i.key).join(","));
  const isFirstRenderRef = useRef(true);
  const [, forceRender] = useState(0);

  // Cancel all pending exit timers on unmount
  useEffect(() => {
    const timers = timersRef;
    return () => {
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    };
  }, []);

  // Clear first render flag after mount
  useEffect(() => {
    isFirstRenderRef.current = false;
  }, []);

  const currentKeyStr = items.map((i) => i.key).join(",");
  if (currentKeyStr !== prevKeysRef.current) {
    const oldPrevKeys = new Set(prevKeysRef.current.split(",").filter(Boolean));
    prevKeysRef.current = currentKeyStr;

    // Cancel timers for items that came back
    for (const item of items) {
      if (timersRef.current.has(item.key)) {
        clearTimeout(timersRef.current.get(item.key)!);
        timersRef.current.delete(item.key);
      }
    }

    // Build map of current items by key
    const currentMap = new Map(items.map((i) => [i.key, i]));
    const prevKeys = new Set(renderedRef.current.map((r) => r.key));

    // Keep items in their previous positions — exiting items stay in place
    const result: (T & { _exiting?: boolean })[] = [];
    const newlyExitingKeys: string[] = [];
    for (const prev of renderedRef.current) {
      if (currentMap.has(prev.key)) {
        result.push({ ...currentMap.get(prev.key)!, _exiting: false });
      } else {
        // Item removed — keep in original position, mark as exiting
        if (!prev._exiting) newlyExitingKeys.push(prev.key);
        result.push({ ...prev, _exiting: true });
      }
    }
    // Append any brand-new items at the end
    for (const item of items) {
      if (!prevKeys.has(item.key)) {
        // Animate enter unless this is the very first render (component just mounted)
        if (!isFirstRenderRef.current) enteringRef.current.add(item.key);
        result.push({ ...item, _exiting: false });
      }
    }
    renderedRef.current = result;

    // Auto-clear entering state after animation completes
    if (enteringRef.current.size > 0) {
      setTimeout(() => {
        enteringRef.current.clear();
      }, duration);
    }

    // Schedule DOM removal for newly exiting items
    for (const key of newlyExitingKeys) {
      const timer = setTimeout(() => {
        timersRef.current.delete(key);
        renderedRef.current = renderedRef.current.filter((r) => r.key !== key);
        forceRender((n) => n + 1);
      }, duration);
      timersRef.current.set(key, timer);
    }
  } else {
    // Keys unchanged — update item data in-place (e.g. isLocked, participant count)
    const currentMap = new Map(items.map((i) => [i.key, i]));
    renderedRef.current = renderedRef.current.map((prev) =>
      currentMap.has(prev.key) ? { ...currentMap.get(prev.key)!, _exiting: prev._exiting } : prev,
    );
  }

  return <>{renderedRef.current.map((item) => {
    const state = item._exiting ? "exiting" : enteringRef.current.has(item.key) ? "entering" : "idle";
    return renderItem(item, state);
  })}</>;
}
