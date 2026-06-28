import type { MetadataRoute } from "next";

// PWA manifest. Icons live in /public; the brand "ink" background (#1E2327) is
// the repo theme color from the brand pack (baklava-brand/README.md).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Baklava",
    short_name: "Baklava",
    description:
      "Open-source unified console for Docker, Kafka, PostgreSQL and the rest of your stack.",
    start_url: "/",
    display: "standalone",
    background_color: "#14181B",
    theme_color: "#1E2327",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
