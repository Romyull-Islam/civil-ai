import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone output lets the Electron desktop shell run the real Next server (API routes + streaming) offline.
  output: "standalone",
  serverExternalPackages: ["@anthropic-ai/sdk", "@google/genai", "openai", "nodemailer", "pg"],
  poweredByHeader: false,
  // keep the desktop bundle and docs out of the standalone server (otherwise output tracing recursively copies desktop/app)
  outputFileTracingExcludes: { "*": ["./desktop/**", "./docs/**", "./tests/**", "./scripts/**"] },
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js runtime + Turbopack dev need inline/eval
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https: http://127.0.0.1:* http://localhost:*",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https:",
    ].join("; ");
    return [{ source: "/(.*)", headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      { key: "Content-Security-Policy", value: csp },
    ] }];
  },
};

export default nextConfig;
