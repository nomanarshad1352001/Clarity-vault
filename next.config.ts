import type { NextConfig } from "next";

/**
 * Strict CSP for the hosted app — keep in sync with server/securityHeaders.js
 * (which applies the same policy when running standalone via Express).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self' https://checkout.stripe.com",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "express",
    "helmet",
    "compression",
    "cookie-parser",
    "jsonwebtoken",
    "bcryptjs",
    "stripe",
  ],
  async rewrites() {
    // Clean URLs for the plain-HTML frontend in /public
    return [
      { source: "/login", destination: "/login.html" },
      { source: "/quote", destination: "/quote.html" },
      { source: "/sales", destination: "/sales.html" },
      { source: "/admin", destination: "/admin.html" },
      { source: "/verify", destination: "/verify.html" },
      { source: "/payment/success", destination: "/payment-success.html" },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
