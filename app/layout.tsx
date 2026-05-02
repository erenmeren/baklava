import type { Metadata } from "next";
import { getOrCreateInstanceToken } from "../lib/security";
import "./globals.css";

export const metadata: Metadata = {
  title: "baklava",
  description: "The unified developer console for the modern stack.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const token = getOrCreateInstanceToken();
  return (
    <html lang="en">
      <head>
        {/* The browser frontend reads this and sends it as X-Baklava-Token on every API call.
            See lib/security.ts for the gate that validates it. */}
        <meta name="baklava-token" content={token} />
      </head>
      <body>{children}</body>
    </html>
  );
}
