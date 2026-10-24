import { describe, expect, it } from "vitest";
import { mountPathOf } from "@/modules/platform/mount-path";

describe("mountPathOf", () => {
  it("finds the platform mount path from the address bar and the route", () => {
    expect(mountPathOf("/app/cadastro", "/cadastro")).toBe("/app");
    expect(
      mountPathOf("/app/profissional/alunos/x1", "/profissional/alunos/x1"),
    ).toBe("/app");
    expect(mountPathOf("/a/b/convite/abc", "/convite/abc")).toBe("/a/b");
  });
  it("is empty when the app is mounted at the root", () => {
    expect(mountPathOf("/cadastro", "/cadastro")).toBe("");
    expect(mountPathOf("/", "/")).toBe("");
  });
  it("handles the home route and trailing slashes", () => {
    expect(mountPathOf("/app", "/")).toBe("/app");
    expect(mountPathOf("/app/", "/")).toBe("/app");
    expect(mountPathOf("/app/cadastro/", "/cadastro")).toBe("/app");
  });
  it("uses the fallback only when the address does not contain the route", () => {
    expect(mountPathOf("/outra/coisa", "/cadastro", "/app")).toBe("/app");
    expect(mountPathOf("/outra/coisa", "/cadastro")).toBe("");
    expect(mountPathOf("/app/cadastro", "/cadastro", "/errado")).toBe("/app");
  });
});

describe("browser addresses", () => {
  it("never depend on the repository's own build variable for the mount path", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk("src");
    const offenders = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      if (!text.startsWith('"use client"')) return false;
      // Client code that calls the API must ask the address bar, not the build.
      const callsApi = /["'`]\/api\//.test(text) || text.includes("/api/auth");
      return (
        text.includes("NEXT_PUBLIC_BASE_PATH") && !file.endsWith("use-mount-path.ts")
      ) || (callsApi && !text.includes("useMountPath"));
    });
    expect(offenders).toEqual([]);
  });
});
