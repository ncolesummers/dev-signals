import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Instrumentation hook (src/instrumentation.ts) is enabled by default in Next.js 16
  // It runs automatic database migrations on app startup
};

export default nextConfig;
