import { describe, expect, it } from "vitest";
import { matches, order, page, parseFilters, project, select, type Doc } from "@/modules/frappe-editor/doc-query";

const doc = (name: string, rest: Record<string, unknown> = {}): Doc => ({ doctype: "Builder Page", name, ...rest });
const names = (docs: Doc[]) => docs.map((entry) => entry.name);

describe("the filters of the editor", () => {
  it("reads an object of values and of [operator, value] pairs", () => {
    expect(parseFilters({ published: 1, route: ["like", "a%"], is_template: 0 })).toEqual([
      { field: "published", operator: "=", value: 1 },
      { field: "route", operator: "like", value: "a%" },
      { field: "is_template", operator: "=", value: 0 },
    ]);
  });
  it("reads a list of rows, with or without the type in front, and the same as JSON text", () => {
    expect(parseFilters([["name", "=", "x"]])).toEqual([{ field: "name", operator: "=", value: "x" }]);
    expect(parseFilters([["Builder Page", "name", "!=", "x"]])).toEqual([{ field: "name", operator: "!=", value: "x" }]);
    expect(parseFilters([["name", "x"]])).toEqual([{ field: "name", operator: "=", value: "x" }]);
    expect(parseFilters('{"name":"x"}')).toEqual([{ field: "name", operator: "=", value: "x" }]);
  });
  it("keeps everything when there is no filter, and refuses what it does not understand instead of answering as if it had not been asked", () => {
    for (const none of [undefined, null, "", {}, []]) expect(parseFilters(none)).toEqual([]);
    for (const bad of [5, "{broken", [["name"]], [["name", "regexp", "x"]], { name: ["regexp", "x"] }, [5], [[1, "=", "x"]]]) {
      expect(() => parseFilters(bad), JSON.stringify(bad)).toThrow("BAD_FILTER");
    }
  });
});

describe("a condition on a document", () => {
  const entry = doc("page-1", { route: "Sobre-Mim", published: 1, draft_blocks: "[]", note: null, n: 10 });
  it("compares as text, so a number and its text are the same value", () => {
    expect(matches(entry, { field: "published", operator: "=", value: "1" })).toBe(true);
    expect(matches(entry, { field: "published", operator: "!=", value: 0 })).toBe(true);
    expect(matches(entry, { field: "missing", operator: "=", value: "" })).toBe(true);
  });
  it("orders numbers as numbers and the rest as text", () => {
    expect(matches(entry, { field: "n", operator: ">", value: 9 })).toBe(true);
    expect(matches(entry, { field: "n", operator: "<", value: 9 })).toBe(false);
    expect(matches(entry, { field: "n", operator: ">=", value: 10 })).toBe(true);
    expect(matches(entry, { field: "n", operator: "<=", value: 10 })).toBe(true);
    expect(matches(entry, { field: "route", operator: ">", value: "A" })).toBe(true);
  });
  it("likes with % and _ ignoring case, and does not let the pattern be a regular expression", () => {
    expect(matches(entry, { field: "route", operator: "like", value: "sobre%" })).toBe(true);
    expect(matches(entry, { field: "route", operator: "like", value: "%MIM" })).toBe(true);
    expect(matches(entry, { field: "route", operator: "like", value: "Sobre_Mim" })).toBe(true);
    expect(matches(entry, { field: "route", operator: "like", value: "Sobre.Mim" })).toBe(false);
    expect(matches(entry, { field: "route", operator: "like", value: ".*" })).toBe(false);
    expect(matches(entry, { field: "route", operator: "not like", value: "x%" })).toBe(true);
  });
  it("knows in, not in, is set, is not set and between", () => {
    expect(matches(entry, { field: "published", operator: "in", value: [1, 2] })).toBe(true);
    expect(matches(entry, { field: "published", operator: "not in", value: [1, 2] })).toBe(false);
    expect(matches(entry, { field: "draft_blocks", operator: "is", value: "set" })).toBe(true);
    expect(matches(entry, { field: "note", operator: "is", value: "not set" })).toBe(true);
    expect(matches(entry, { field: "missing", operator: "is", value: "not set" })).toBe(true);
    expect(matches(entry, { field: "route", operator: "between", value: ["A", "Z"] })).toBe(true);
    expect(matches(entry, { field: "route", operator: "between", value: ["a"] })).toBe(false);
  });
});

describe("the documents kept by a list", () => {
  const docs = [doc("a", { published: 1, staging: 0 }), doc("b", { published: 0, staging: 1 }), doc("c", { published: 0, staging: 0 })];
  it("keeps what holds every filter and at least one of the or-filters", () => {
    expect(names(select(docs, { published: 0 }, undefined))).toEqual(["b", "c"]);
    expect(names(select(docs, undefined, { published: 1, staging: 1 }))).toEqual(["a", "b"]);
    expect(names(select(docs, { published: 0 }, { staging: 1 }))).toEqual(["b"]);
    expect(names(select(docs, undefined, undefined))).toEqual(["a", "b", "c"]);
  });
});

describe("the order, the fields and the page of a list", () => {
  const docs = [doc("a", { modified: "2026-01-02", n: "x" }), doc("b", { modified: "2026-01-03", n: "x" }), doc("c", { modified: "2026-01-01", n: "y" })];
  it("orders by one or more fields, in the direction asked, and leaves an unreadable order as it is", () => {
    expect(names(order(docs, "modified desc"))).toEqual(["b", "a", "c"]);
    expect(names(order(docs, "modified asc"))).toEqual(["c", "a", "b"]);
    expect(names(order(docs, "n desc, modified asc"))).toEqual(["c", "a", "b"]);
    expect(names(order(docs, "`tabBuilder Page`.modified desc"))).toEqual(["b", "a", "c"]);
    expect(names(order(docs, ""))).toEqual(["a", "b", "c"]);
    expect(names(order(docs, undefined))).toEqual(["a", "b", "c"]);
  });
  it("does not change the list it was given", () => {
    const before = names(docs);
    order(docs, "modified desc");
    expect(names(docs)).toEqual(before);
  });
  it("gives back the fields asked for, from a list or from JSON text, and everything for * or nothing", () => {
    const full = doc("a", { route: "r", blocks: "[]" });
    expect(project(full, ["name", "route"])).toEqual({ name: "a", route: "r" });
    expect(project(full, '["route"]')).toEqual({ route: "r" });
    expect(project(full, ["`tabBuilder Page`.route", "`tabBuilder Page`.`blocks`"])).toEqual({ route: "r", blocks: "[]" });
    expect(project(full, ["*"])).toEqual(full);
    expect(project(full, undefined)).toEqual(full);
    expect(project(full, [])).toEqual(full);
    expect(project(full, "*")).toEqual(full);
    expect(project(full, [5, "route"])).toEqual({ route: "r" });
  });
  it("cuts the page from where it starts, for as many as asked, and gives the rest when no length is asked", () => {
    expect(page([1, 2, 3, 4], 1, 2)).toEqual([2, 3]);
    expect(page([1, 2, 3, 4], 0, 0)).toEqual([1, 2, 3, 4]);
    expect(page([1, 2, 3, 4], "2", undefined)).toEqual([3, 4]);
    expect(page([1, 2, 3, 4], -3, 2)).toEqual([1, 2]);
    expect(page([1, 2, 3, 4], 9, 2)).toEqual([]);
  });
});
