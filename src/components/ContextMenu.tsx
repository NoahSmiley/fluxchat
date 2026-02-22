import { useLayoutEffect, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export interface ContextMenuSeparator {
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

  // Position so cursor is always at a corner of the menu
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer opening right+down; flip each axis independently if no room
    const left = x + width <= vw - 8 ? x : x - width;
    const top = y + height <= vh - 8 ? y : y - height;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [x, y]);

  // Dismiss on outside mousedown, Escape, and scroll
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
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
    };
  }, [onClose]);

  return createPortal(
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
        return (
          <button
            key={i}
            className={`context-menu-item${item.danger ? " danger" : ""}`}
            disabled={item.disabled}
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
  );
}
