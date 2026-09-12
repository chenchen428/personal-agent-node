import "@fontsource/cormorant-garamond/latin-400.css";
import "@fontsource/cormorant-garamond/latin-500.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./cove-theme.css";
import coveIcon from "../components/brand/cove-icon.svg";
import coveTouchIcon from "../components/brand/cove-touch-icon.png";

export const metadata: Metadata = {
  title: { default: "Cove", template: "%s · Cove" },
  icons: { icon: coveIcon.src, apple: coveTouchIcon.src },
  applicationName: "Cove",
  description: "Connect your files, email, and tools. Your data. Put to work.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" data-brand="cove">
      <body>{children}</body>
    </html>
  );
}
