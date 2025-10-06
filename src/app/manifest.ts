import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JOIN US Demo",
    short_name: "JoinUs",
    description: "Browser-based presence, nearby matching, and chat demo.",
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#22c55e",
    lang: "ja-JP",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "64x64",
        type: "image/x-icon",
      }
    ],
  };
}
