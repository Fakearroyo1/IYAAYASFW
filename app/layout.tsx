import type { Metadata, Viewport } from "next";
import "./globals.css";
import { headers } from "next/headers";
export const metadata: Metadata = {
  title: "IYAAYASFW · Unit Supply",
  description: "Your unit snack bar. Snacks, member tabs, and unit gear.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/brand/logo.png", type: "image/png", sizes: "1080x1080" }],
    apple: [{ url: "/brand/logo.png", sizes: "1080x1080" }],
  },
  appleWebApp: { capable: true, title: "IYAAYASFW", statusBarStyle: "default" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#111214" },
  ],
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const csp = (await headers()).get("content-security-policy") || "";
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script src="/theme.js" nonce={nonce} />
      </head>
      <body>{children}</body>
    </html>
  );
}
