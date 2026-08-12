import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Penni Oinkbank Display",
    short_name: "Penni",
    description: "A dedicated Android display for Penni Oinkbank.",
    start_url: "/display",
    scope: "/",
    display: "standalone",
    // @ts-expect-error — display_override is valid but not yet in Next.js types
    display_override: ["standalone", "minimal-ui"],
    orientation: "landscape",
    background_color: "#fbf4e8",
    theme_color: "#55c8da",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
