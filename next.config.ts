import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

const localNetworkOrigins = Object.values(networkInterfaces())
  .flatMap((entries) => entries ?? [])
  .filter((entry) => entry.family === "IPv4" && !entry.internal)
  .map((entry) => entry.address);

const nextConfig: NextConfig = {
  ...(process.env.NODE_ENV === "development"
    ? { allowedDevOrigins: localNetworkOrigins }
    : {}),
  typescript: {
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        // Le service worker doit toujours être revalidé pour que les mises à jour soient détectées.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        source: "/icons/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
    ];
  },
};

export default nextConfig;
