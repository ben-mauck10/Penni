import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Penni the Oinkbank",
  description: "A parent-guided money habit companion for kids.",
  applicationName: "Penni Display",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#55c8da",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
