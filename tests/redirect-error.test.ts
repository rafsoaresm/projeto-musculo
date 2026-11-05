import { describe, expect, it } from "vitest";
import { isRedirectError } from "@/modules/prescricao/automatica/use-intent";

describe("isRedirectError", () => {
  it("recognises the error a server action throws when it ends in redirect()", () => {
    expect(isRedirectError({ digest: "NEXT_REDIRECT;replace;/profissional/x;307;" })).toBe(true);
    expect(isRedirectError(new Error("NEXT_REDIRECT"))).toBe(true);
  });
  it("does not hide real failures", () => {
    expect(isRedirectError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isRedirectError({ digest: "123" })).toBe(false);
    expect(isRedirectError(null)).toBe(false);
    expect(isRedirectError("NEXT_REDIRECT")).toBe(false);
  });
});
