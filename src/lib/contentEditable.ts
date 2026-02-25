/** Count chars to range.startContainer/startOffset, treating each twemoji <img> as 1 char. */
export function getCharOffset(root: HTMLElement, range: Range): number {
  let count = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node === range.startContainer) { count += range.startOffset; break; }
    if (node.nodeType === Node.TEXT_NODE) count += (node as Text).length;
    else if ((node as Element).tagName === "IMG") count += 1;
    node = walker.nextNode();
  }
  return count;
}

/** Place cursor at charOffset inside root, treating each twemoji <img> as 1 char. */
export function setCursorAtOffset(root: HTMLElement, charOffset: number): void {
  let remaining = charOffset;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node as Text).length;
      if (remaining <= len) {
        const r = document.createRange();
        r.setStart(node, remaining); r.collapse(true);
        const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r);
        return;
      }
      remaining -= len;
    } else if ((node as Element).tagName === "IMG") {
      if (remaining === 0) {
        const r = document.createRange();
        r.setStartBefore(node); r.collapse(true);
        const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r);
        return;
      }
      remaining -= 1;
    }
    node = walker.nextNode();
  }
  const r = document.createRange();
  r.selectNodeContents(root); r.collapse(false);
  const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r);
}

/** Read plain text, treating twemoji <img> alt as the original emoji char. */
export function getDivPlainText(div: HTMLElement): string {
  let text = "";
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_ALL);
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) text += (node as Text).data;
    else if ((node as Element).tagName === "IMG") text += (node as Element).getAttribute("alt") ?? "";
    node = walker.nextNode();
  }
  return text;
}

/** Plain text from start-of-div to current cursor (for @mention detection). */
export function getTextBeforeCursor(div: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return "";
  const range = sel.getRangeAt(0).cloneRange();
  range.setStart(div, 0);
  const frag = range.cloneContents();
  let text = "";
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_ALL);
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) text += (node as Text).data;
    else if ((node as Element).tagName === "IMG") text += (node as Element).getAttribute("alt") ?? "";
    node = walker.nextNode();
  }
  return text;
}
