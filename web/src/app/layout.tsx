import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "X Bookmarks",
  description: "Self-hosted X bookmark archive",
};

// Set data-theme + data-accent before first paint to avoid a flash of wrong theme.
const themeInit = `
try {
  var t = localStorage.getItem("theme");
  if (t !== "light" && t !== "dark") {
    t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.dataset.theme = t;
  var a = localStorage.getItem("accent");
  if (["indigo", "coral", "sky", "mono"].indexOf(a) === -1) a = "indigo";
  document.documentElement.dataset.accent = a;
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
