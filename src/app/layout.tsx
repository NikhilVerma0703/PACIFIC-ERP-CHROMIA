import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pacific ERP",
  description: "Pacific Surfaces production ERP",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Pacific ERP" },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192" }, { url: "/icon-512.png", sizes: "512x512" }],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#112732",
  viewportFit: "cover",
};

// Stamps the collapsed-sidebar choice on <html> BEFORE the first paint, the
// way a dark-mode boot script does. CollapsibleSidebar keeps the choice in
// localStorage and reads it after mount; without this, every navigation (the
// Shell lives in each page.tsx, so Next remounts it per route) painted the
// rail open and slid it shut. globals.css turns the attribute into width: 0
// on `.pacific-rail`, and CollapsibleSidebar.toggle keeps it in step. Inline
// and synchronous on purpose — next/script's beforeInteractive runs from the
// runtime bundle, after the first frame. suppressHydrationWarning on <html>
// is the standard companion: the attribute is set by this script only, so the
// server markup never carries it, and React must not treat that as a mismatch.
const SIDEBAR_BOOT =
  'try{if(localStorage.getItem("pacific-sidebar-hidden")==="1")document.documentElement.setAttribute("data-sidebar-hidden","1")}catch(e){}';

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_BOOT }} />
        {children}
      </body>
    </html>
  );
}
