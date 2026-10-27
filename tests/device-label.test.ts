import { describe, expect, it } from "vitest";
import { deviceLabel } from "@/modules/auth/device";

const UA = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  operaWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0",
  headlessChromeLinux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36",
};

describe("the short name of a device", () => {
  it("names the browser and the system, taking the browsers that also say Chrome or Safari for what they are", () => {
    expect(deviceLabel(UA.chromeWindows)).toBe("Chrome em Windows");
    expect(deviceLabel(UA.edgeWindows)).toBe("Edge em Windows");
    expect(deviceLabel(UA.operaWindows)).toBe("Opera em Windows");
    expect(deviceLabel(UA.firefoxLinux)).toBe("Firefox em Linux");
    expect(deviceLabel(UA.safariMac)).toBe("Safari em macOS");
    expect(deviceLabel(UA.headlessChromeLinux)).toBe("Chrome em Linux");
  });
  it("tells a phone from the system it imitates: Android is not Linux and the iPhone is not a Mac", () => {
    expect(deviceLabel(UA.chromeAndroid)).toBe("Chrome em Android");
    expect(deviceLabel(UA.safariIphone)).toBe("Safari em iPhone");
    expect(deviceLabel(UA.chromeIphone)).toBe("Chrome em iPhone");
  });
  it("says so when it cannot tell, and never returns the header it was given", () => {
    expect(deviceLabel(null)).toBe("Aparelho não identificado");
    expect(deviceLabel(undefined)).toBe("Aparelho não identificado");
    expect(deviceLabel("")).toBe("Aparelho não identificado");
    expect(deviceLabel("curl/8.5.0")).toBe("Aparelho não identificado");
    expect(deviceLabel("Windows <script>alert(1)</script>")).toBe("Windows");
    expect(deviceLabel("x".repeat(100_000))).toBe("Aparelho não identificado");
  });
});
