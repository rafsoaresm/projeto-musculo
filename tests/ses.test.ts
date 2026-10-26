import { describe, expect, it } from "vitest";
import { signRequest, signingKey } from "@/modules/email/sigv4";
import { EmailError, sendWithSes } from "@/modules/email/ses";
import type { SesSettings } from "@/modules/email/config";
import { passwordResetMessage } from "@/modules/email/messages";

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

// The access key and secret that AWS itself publishes in its documentation. They open nothing.
const EXAMPLE_KEY = "AKIDEXAMPLE";
const EXAMPLE_SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";

describe("AWS Signature Version 4, against the examples AWS publishes", () => {
  it("derives the signing key of the documented example", async () => {
    expect(hex(await signingKey(EXAMPLE_SECRET, "20120215", "us-east-1", "iam"))).toBe(
      "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d",
    );
  });

  it("signs the documented GET request exactly as AWS does", async () => {
    const headers = await signRequest({
      method: "GET",
      url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
      region: "us-east-1",
      service: "iam",
      accessKeyId: EXAMPLE_KEY,
      secretAccessKey: EXAMPLE_SECRET,
      now: new Date("2015-08-30T12:36:00Z"),
    });
    expect(headers["x-amz-date"]).toBe("20150830T123600Z");
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, " +
        "SignedHeaders=content-type;host;x-amz-date, " +
        "Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
    // The host is signed but left to the runtime to send; the secret is nowhere in what is returned.
    expect(Object.keys(headers).sort()).toEqual(["authorization", "content-type", "x-amz-date"]);
    expect(JSON.stringify(headers)).not.toContain(EXAMPLE_SECRET);
  });

  it("changes the signature when anything signed changes", async () => {
    const base = {
      method: "POST",
      url: "https://email.us-east-1.amazonaws.com/v2/email/outbound-emails",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
      region: "us-east-1",
      service: "ses",
      accessKeyId: EXAMPLE_KEY,
      secretAccessKey: EXAMPLE_SECRET,
      now: new Date("2026-11-01T10:00:00Z"),
    };
    const signature = async (change: Partial<typeof base>) => (await signRequest({ ...base, ...change })).authorization.split("Signature=")[1];
    const original = await signature({});
    expect(original).toMatch(/^[0-9a-f]{64}$/);
    expect(await signature({})).toBe(original);
    expect(await signature({ body: '{"a":2}' })).not.toBe(original);
    expect(await signature({ region: "sa-east-1" })).not.toBe(original);
    expect(await signature({ now: new Date("2026-11-01T10:00:01Z") })).not.toBe(original);
    expect(await signature({ url: "https://email.us-east-1.amazonaws.com/v2/email/other" })).not.toBe(original);
    expect(await signature({ secretAccessKey: `${EXAMPLE_SECRET}x` })).not.toBe(original);
  });
});

const settings: SesSettings = {
  transport: "ses",
  region: "sa-east-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "a-secret-that-must-never-leave-the-worker-0123456789",
  from: "Trainer <nao-responda@example.test>",
};
const message = passwordResetMessage("aluno@example.test", "https://app.example.test/redefinir-senha#token=abc");

describe("sending through Amazon SES", () => {
  it("posts one signed JSON request to the regional endpoint, with the text and no secret", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return Response.json({ MessageId: "0100-example-message-id" });
    }) as unknown as typeof fetch;
    const sent = await sendWithSes(settings, message, fetcher, new Date("2026-11-01T10:00:00Z"));
    expect(sent).toEqual({ messageId: "0100-example-message-id" });
    expect(seen!.url).toBe("https://email.sa-east-1.amazonaws.com/v2/email/outbound-emails");
    expect(seen!.init.method).toBe("POST");
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20261101\/sa-east-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(seen!.init.body as string);
    expect(body).toEqual({
      FromEmailAddress: "Trainer <nao-responda@example.test>",
      Destination: { ToAddresses: ["aluno@example.test"] },
      Content: {
        Simple: {
          Subject: { Data: "Redefinir a sua senha", Charset: "UTF-8" },
          Body: { Text: { Data: message.text, Charset: "UTF-8" } },
        },
      },
    });
    // Nothing that opens an account is anywhere but the signature, and that does not contain it.
    expect(JSON.stringify([seen!.url, headers, seen!.init.body])).not.toContain(settings.secretAccessKey);
    expect(seen!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("names the failure by its code and never carries what the provider answered", async () => {
    const failing = (status: number, type?: string) =>
      (async () =>
        new Response('{"message":"The security token included in the request is invalid. aluno@example.test"}', {
          status,
          headers: type ? { "x-amzn-errortype": type } : {},
        })) as unknown as typeof fetch;
    const error = await sendWithSes(settings, message, failing(403, "UnrecognizedClientException:http://internal.amazon.com/"), new Date()).catch((e) => e);
    expect(error).toBeInstanceOf(EmailError);
    expect(error.code).toBe("SES_403_UnrecognizedClientException");
    expect(error.message).toBe("SES_403_UnrecognizedClientException");
    expect(error.message).not.toContain("example.test");
    expect((await sendWithSes(settings, message, failing(400, "MessageRejected"), new Date()).catch((e) => e)).code).toBe("SES_400_MessageRejected");
    expect((await sendWithSes(settings, message, failing(500), new Date()).catch((e) => e)).code).toBe("SES_500");
  });

  it("reports an unreachable provider and a timeout apart, and tolerates an answer without id", async () => {
    const unreachable = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const timeout = (async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    expect((await sendWithSes(settings, message, unreachable).catch((e) => e)).code).toBe("SES_UNREACHABLE");
    expect((await sendWithSes(settings, message, timeout).catch((e) => e)).code).toBe("SES_TIMEOUT");
    const noId = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
    expect(await sendWithSes(settings, message, noId)).toEqual({ messageId: null });
  });
});

describe("the reset message", () => {
  it("carries the link and the way out, and nothing about the person's health or plan", () => {
    expect(message.to).toBe("aluno@example.test");
    expect(message.subject).toBe("Redefinir a sua senha");
    expect(message.text).toContain("https://app.example.test/redefinir-senha#token=abc");
    expect(message.text).toContain("vale por 1 hora");
    expect(message.text).toContain("ignore esta mensagem");
    // It names the tool and nothing the person did in it.
    expect(message.text).not.toMatch(/foto|avalia|\bdor\b|check-in|aluno|\bplano\b/i);
  });
});
