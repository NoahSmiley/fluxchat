import { describe, it, expect } from "vitest";
import { getDivPlainText, getCharOffset } from "../contentEditable.js";

// NOTE: setCursorAtOffset and getTextBeforeCursor rely on window.getSelection()
// which jsdom does not fully support (returns null or a stub). These functions
// are skipped — they require a real browser environment to test meaningfully.

describe("getDivPlainText", () => {
  it("returns empty string for an empty div", () => {
    const div = document.createElement("div");
    expect(getDivPlainText(div)).toBe("");
  });

  it("extracts plain text from a simple text node", () => {
    const div = document.createElement("div");
    div.textContent = "Hello world";
    expect(getDivPlainText(div)).toBe("Hello world");
  });

  it("concatenates text from multiple text nodes", () => {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode("Hello "));
    div.appendChild(document.createTextNode("world"));
    expect(getDivPlainText(div)).toBe("Hello world");
  });

  it("uses alt text for img elements (twemoji)", () => {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode("Hello "));
    const img = document.createElement("img");
    img.alt = "\u{1F600}"; // grinning face emoji
    div.appendChild(img);
    div.appendChild(document.createTextNode(" world"));
    expect(getDivPlainText(div)).toBe("Hello \u{1F600} world");
  });

  it("returns empty string for img without alt", () => {
    const div = document.createElement("div");
    const img = document.createElement("img");
    div.appendChild(img);
    expect(getDivPlainText(div)).toBe("");
  });

  it("handles nested elements (spans, etc.)", () => {
    const div = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = "nested text";
    div.appendChild(document.createTextNode("before "));
    div.appendChild(span);
    div.appendChild(document.createTextNode(" after"));
    expect(getDivPlainText(div)).toBe("before nested text after");
  });

  it("handles multiple img elements interspersed with text", () => {
    const div = document.createElement("div");
    const img1 = document.createElement("img");
    img1.alt = "A";
    const img2 = document.createElement("img");
    img2.alt = "B";
    div.appendChild(img1);
    div.appendChild(document.createTextNode(" and "));
    div.appendChild(img2);
    expect(getDivPlainText(div)).toBe("A and B");
  });

  it("handles deeply nested structure", () => {
    const div = document.createElement("div");
    const outer = document.createElement("span");
    const inner = document.createElement("b");
    inner.textContent = "bold";
    outer.appendChild(document.createTextNode("start "));
    outer.appendChild(inner);
    outer.appendChild(document.createTextNode(" end"));
    div.appendChild(outer);
    expect(getDivPlainText(div)).toBe("start bold end");
  });
});

describe("getCharOffset", () => {
  it("returns 0 when range starts at the beginning", () => {
    const div = document.createElement("div");
    const text = document.createTextNode("Hello");
    div.appendChild(text);
    document.body.appendChild(div);

    const range = document.createRange();
    range.setStart(text, 0);

    expect(getCharOffset(div, range)).toBe(0);
    document.body.removeChild(div);
  });

  it("returns correct offset within a single text node", () => {
    const div = document.createElement("div");
    const text = document.createTextNode("Hello world");
    div.appendChild(text);
    document.body.appendChild(div);

    const range = document.createRange();
    range.setStart(text, 5);

    expect(getCharOffset(div, range)).toBe(5);
    document.body.removeChild(div);
  });

  it("counts text length of preceding text nodes", () => {
    const div = document.createElement("div");
    const text1 = document.createTextNode("abc");
    const text2 = document.createTextNode("def");
    div.appendChild(text1);
    div.appendChild(text2);
    document.body.appendChild(div);

    const range = document.createRange();
    range.setStart(text2, 2);

    // 3 chars from text1 + 2 chars offset into text2
    expect(getCharOffset(div, range)).toBe(5);
    document.body.removeChild(div);
  });

  it("counts img elements as 1 character each", () => {
    const div = document.createElement("div");
    const text1 = document.createTextNode("Hi");
    const img = document.createElement("img");
    img.alt = "\u{1F600}";
    const text2 = document.createTextNode("there");
    div.appendChild(text1);
    div.appendChild(img);
    div.appendChild(text2);
    document.body.appendChild(div);

    const range = document.createRange();
    range.setStart(text2, 1);

    // 2 (text1) + 1 (img) + 1 (offset into text2)
    expect(getCharOffset(div, range)).toBe(4);
    document.body.removeChild(div);
  });
});
