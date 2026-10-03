import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KIVO — programmable token markets",
  description: "Compose visible swap rules, explore blueprints and preview a token launch on Solana.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
