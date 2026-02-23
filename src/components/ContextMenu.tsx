import { useState, useLayoutEffect, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  submenu?: ContextMenuEntry[];
}

interface ContextMenuSeparator {
  type: "separator";
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeSubmenuIdx, setActiveSubmenuIdx] = useState<number | null>(null);
  const [submenuStyle, setSubmenuStyle] = useState<React.CSSProperties>({ position: "fixed", left: -9999, top: -9999 });

  // Position parent menu so cursor is always at a corner
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = x + width <= vw - 8 ? x : x - width;
    const top = y + height <= vh - 8 ? y : y - height;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [x, y]);

  // Position submenu adjacent to the hovered item
  useLayoutEffect(() => {
    if (activeSubmenuIdx === null || !submenuRef.current) return;
    const itemEl = itemRefs.current[activeSubmenuIdx];
    if (!itemEl) return;
    const itemRect = itemEl.getBoundingClientRect();
    const subRect = submenuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = itemRect.right + 4;
    if (left + subRect.width > vw - 8) left = itemRect.left - subRect.width - 4;
    let top = itemRect.top;
    if (top + subRect.height > vh - 8) top = Math.max(8, vh - 8 - subRect.height);
    setSubmenuStyle({ position: "fixed", left, top });
  }, [activeSubmenuIdx]);

  function openSubmenu(idx: number) {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    setActiveSubmenuIdx(idx);
  }

  function scheduleClose() {
    closeTimerRef.current = setTimeout(() => setActiveSubmenuIdx(null), 150);
  }

  function cancelClose() {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
  }

  // Dismiss on outside mousedown, Escape, and scroll
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const inMenu = menuRef.current?.contains(e.target as Node);
      const inSub = submenuRef.current?.contains(e.target as Node);
      if (!inMenu && !inSub) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleScroll = () => onClose();

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", handleScroll, true);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [onClose]);

  const activeSubItems = activeSubmenuIdx !== null
    ? (items[activeSubmenuIdx] as ContextMenuItem).submenu ?? null
    : null;

  return (
    <>
      {createPortal(
        <div
          ref={menuRef}
          className="context-menu"
          style={{ left: x, top: y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {items.map((entry, i) => {
            if ("type" in entry && entry.type === "separator") {
              return <div key={i} className="context-menu-separator" />;
            }
            const item = entry as ContextMenuItem;
            const hasSub = !!item.submenu?.length;
            return (
              <button
                key={i}
                ref={(el) => { itemRefs.current[i] = el; }}
                className={`context-menu-item${item.danger ? " danger" : ""}${hasSub ? " has-submenu" : ""}`}
                disabled={item.disabled}
                onMouseEnter={hasSub
                  ? () => openSubmenu(i)
                  : () => { cancelClose(); setActiveSubmenuIdx(null); }
                }
                onMouseLeave={hasSub ? scheduleClose : undefined}
                onClick={item.disabled ? undefined : item.onClick}
              >
                {item.checked !== undefined && (
                  <span className={`context-menu-check${item.checked ? " checked" : ""}`} />
                )}
                {item.icon && <span className="context-menu-icon">{item.icon}</span>}
                {item.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}

      {activeSubItems && createPortal(
        <div
          ref={submenuRef}
          className="context-menu"
          style={submenuStyle}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {activeSubItems.map((entry, j) => {
            if ("type" in entry && entry.type === "separator") {
              return <div key={j} className="context-menu-separator" />;
            }
            const sub = entry as ContextMenuItem;
            return (
              <button
                key={j}
                className={`context-menu-item${sub.danger ? " danger" : ""}`}
                disabled={sub.disabled}
                onClick={sub.disabled ? undefined : sub.onClick}
              >
                {sub.checked !== undefined && (
                  <span className={`context-menu-check${sub.checked ? " checked" : ""}`} />
                )}
                {sub.icon && <span className="context-menu-icon">{sub.icon}</span>}
                {sub.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
