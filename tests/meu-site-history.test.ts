import { describe, expect, it } from "vitest";
import { COALESCE_MS, HISTORY_LIMIT, historyReducer, startHistory } from "@/modules/meu-site/editor-history";
import { starterContent, type SiteContent } from "@/modules/meu-site/contracts";

const doc = (title: string): SiteContent => ({ ...starterContent("Base"), title });

describe("undo and redo", () => {
  it("goes back and forth through the changes, and a new change after going back drops what could be redone", () => {
    let h = startHistory(doc("a"));
    h = historyReducer(h, { type: "edit", content: doc("b"), at: 0 });
    h = historyReducer(h, { type: "edit", content: doc("c"), at: 10 });
    expect(h.present.title).toBe("c");
    h = historyReducer(h, { type: "undo" });
    expect(h.present.title).toBe("b");
    h = historyReducer(h, { type: "undo" });
    expect(h.present.title).toBe("a");
    expect(historyReducer(h, { type: "undo" })).toBe(h);
    h = historyReducer(h, { type: "redo" });
    expect(h.present.title).toBe("b");
    h = historyReducer(h, { type: "edit", content: doc("x"), at: 20 });
    expect(h.future).toEqual([]);
    expect(historyReducer(h, { type: "redo" })).toBe(h);
    h = historyReducer(h, { type: "undo" });
    expect(h.present.title).toBe("b");
  });
  it("is no step when the change is the very same document", () => {
    const start = startHistory(doc("a"));
    expect(historyReducer(start, { type: "edit", content: start.present, at: 0 })).toBe(start);
  });
  it("joins the typing of one field into one step, but not different fields, nor typing after a pause", () => {
    let h = startHistory(doc("a"));
    h = historyReducer(h, { type: "edit", content: doc("ab"), at: 0, key: "title" });
    h = historyReducer(h, { type: "edit", content: doc("abc"), at: 300, key: "title" });
    h = historyReducer(h, { type: "edit", content: doc("abcd"), at: 600, key: "title" });
    expect(h.past).toHaveLength(1);
    expect(h.past[0].title).toBe("a");
    h = historyReducer(h, { type: "edit", content: doc("abcde"), at: 700, key: "description" });
    expect(h.past).toHaveLength(2);
    h = historyReducer(h, { type: "edit", content: doc("abcdef"), at: 700 + COALESCE_MS + 1, key: "description" });
    expect(h.past).toHaveLength(3);
    h = historyReducer(h, { type: "edit", content: doc("z"), at: 700 + COALESCE_MS + 2 });
    h = historyReducer(h, { type: "edit", content: doc("zz"), at: 700 + COALESCE_MS + 3 });
    expect(h.past).toHaveLength(5);
  });
  it("starts a new step after undoing, even for the same field", () => {
    let h = startHistory(doc("a"));
    h = historyReducer(h, { type: "edit", content: doc("ab"), at: 0, key: "title" });
    h = historyReducer(h, { type: "undo" });
    h = historyReducer(h, { type: "edit", content: doc("ac"), at: 10, key: "title" });
    expect(h.past.map((d) => d.title)).toEqual(["a"]);
    expect(h.present.title).toBe("ac");
  });
  it("keeps the last steps only", () => {
    let h = startHistory(doc("0"));
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = historyReducer(h, { type: "edit", content: doc(String(i)), at: i });
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0].title).toBe("10");
    expect(h.present.title).toBe(String(HISTORY_LIMIT + 10));
  });
  it("forgets the history when a version comes back from the server", () => {
    let h = startHistory(doc("a"));
    h = historyReducer(h, { type: "edit", content: doc("b"), at: 0 });
    h = historyReducer(h, { type: "replace", content: doc("restored") });
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(h.present.title).toBe("restored");
  });
});
