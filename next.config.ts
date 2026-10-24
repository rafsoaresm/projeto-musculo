import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Use the same local D1 state as Wrangler migrations and Worker preview. The local configuration
// also has the photo bucket; the one the platform deploys (wrangler.json) has it only once the
// Object Storage is enabled for the account.
initOpenNextCloudflareForDev({ configPath: "wrangler.photos.json" });

const rawBasePath = process.env.BASE_URL || "";
const basePath = rawBasePath === "/" ? "" : rawBasePath;
if (basePath && !/^\/[a-zA-Z0-9/_-]+$/.test(basePath)) {
  throw new Error("BASE_URL deve ser um caminho, como /treinador.");
}
if (basePath.endsWith("/")) throw new Error("BASE_URL não pode terminar em /.");

const config: NextConfig = {
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  basePath,
  assetPrefix: process.env.ASSETS_PREFIX || basePath,
  // The documented local origin is 127.0.0.1; without this the dev server blocks its own HMR.
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  reactStrictMode: true,
  // Addresses from before the split by role keep working (basePath is added).
  async redirects() {
    return [
      { source: "/alunos", destination: "/profissional/alunos", permanent: false },
      {
        source: "/alunos/:path*",
        destination: "/profissional/alunos/:path*",
        permanent: false,
      },
      {
        source: "/planejamento",
        destination: "/profissional/periodizacao",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
