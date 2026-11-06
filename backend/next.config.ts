import type { NextConfig } from "next";

// Sibra Digital Hub — backend (API-only Next.js app).
// Serves all /api/* route handlers; has no UI pages.
const nextConfig: NextConfig = {
  reactStrictMode: false,
  // T4: native/bundling-sensitive auth deps must stay external server modules.
  serverExternalPackages: ["@node-rs/argon2", "@simplewebauthn/server", "otplib", "qrcode"],
};

export default nextConfig;
