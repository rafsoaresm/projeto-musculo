import { describe, expect, it } from "vitest";
import { readEmailSettings, validSender } from "@/modules/email/config";

const FULL = {
  AWS_REGION: "sa-east-1",
  AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  EMAIL_FROM: "Trainer <nao-responda@example.test>",
};
const PRODUCTION = "https://projeto-musculo.webflow.io";

describe("what counts as a configured e-mail", () => {
  it("is Amazon SES only when the region, the key pair and the sender are all there and well formed", () => {
    expect(readEmailSettings(FULL, {}, PRODUCTION)).toEqual({
      transport: "ses",
      region: "sa-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      from: "Trainer <nao-responda@example.test>",
    });
    for (const missing of Object.keys(FULL)) {
      const partial: Record<string, string | undefined> = { ...FULL };
      delete partial[missing];
      expect(readEmailSettings(partial, {}, PRODUCTION), `without ${missing}`).toBeNull();
    }
    expect(readEmailSettings({}, {}, PRODUCTION)).toBeNull();
  });

  it("reads the Worker variable first and the dashboard variable (process.env) when the Worker has none", () => {
    expect(readEmailSettings({}, FULL, PRODUCTION)).toMatchObject({ transport: "ses", region: "sa-east-1" });
    expect(readEmailSettings({ AWS_REGION: "us-east-1" }, FULL, PRODUCTION)).toMatchObject({ region: "us-east-1" });
    // Spaces around a pasted value do not break it.
    expect(readEmailSettings({ ...FULL, AWS_REGION: " sa-east-1 \n" }, {}, PRODUCTION)).toMatchObject({ region: "sa-east-1" });
  });

  it("refuses anything that does not look like what AWS issues, instead of failing when someone needs it", () => {
    const bad = (change: Record<string, string>) => readEmailSettings({ ...FULL, ...change }, {}, PRODUCTION);
    expect(bad({ AWS_REGION: "brazil" })).toBeNull();
    expect(bad({ AWS_REGION: "sa-east-1.evil.test/" })).toBeNull();
    expect(bad({ AWS_ACCESS_KEY_ID: "akia-lowercase-key" })).toBeNull();
    expect(bad({ AWS_ACCESS_KEY_ID: "SHORT" })).toBeNull();
    expect(bad({ AWS_SECRET_ACCESS_KEY: "short" })).toBeNull();
    expect(bad({ AWS_SECRET_ACCESS_KEY: "has a space in the middle of the secret key" })).toBeNull();
    expect(bad({ EMAIL_FROM: "not an address" })).toBeNull();
    expect(bad({ EMAIL_FROM: "Two\nLines <a@example.test>" })).toBeNull();
    expect(bad({ EMAIL_FROM: "a@example.test, b@example.test" })).toBeNull();
  });

  it("accepts a plain address or a named one as the sender", () => {
    expect(validSender("nao-responda@example.test")).toBe(true);
    expect(validSender("Trainer Prescription <nao-responda@example.test>")).toBe(true);
    expect(validSender("<nao-responda@example.test>")).toBe(false);
    expect(validSender("x".repeat(250) + "@example.test")).toBe(false);
  });

  it("honours the local capture transport on localhost and nowhere else", () => {
    const capture = { EMAIL_TRANSPORT: "capture" };
    expect(readEmailSettings(capture, {}, "http://127.0.0.1:8787")).toMatchObject({ transport: "capture" });
    expect(readEmailSettings(capture, {}, "http://localhost:3000")).toMatchObject({ transport: "capture" });
    // A stray variable in production, or on a lookalike host, switches nothing on.
    expect(readEmailSettings(capture, {}, PRODUCTION)).toBeNull();
    expect(readEmailSettings(capture, {}, "https://127.0.0.1.evil.test")).toBeNull();
    expect(readEmailSettings(capture, {}, "https://localhost.evil.test")).toBeNull();
    expect(readEmailSettings(capture, {}, "not a url")).toBeNull();
    // Even with the provider fully configured, "capture" on a real address does not fall back to sending.
    expect(readEmailSettings({ ...FULL, ...capture }, {}, PRODUCTION)).toBeNull();
  });
});
