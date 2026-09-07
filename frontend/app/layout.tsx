import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "../styles/globals.css";
import { Providers } from "@/components/Providers";
import { AppNav } from "@/components/AppNav";
import { Footer } from "@/components/Footer";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Sentinel — Live SLA truth-bonds",
  description:
    "Sellers post a GEN bond behind their advertised spec. Anyone can trigger an audit: GenLayer independently fetches the live endpoint and judges it against that spec under the Equivalence Principle. A sustained streak of confirmed violations slashes the bond into a claims pool for the buyers who were relying on it.",
};

// Every route depends on client-side wallet state (RainbowKit/wagmi), so
// there's nothing meaningful to statically prerender -- and
// getDefaultConfig throws at module-init time without a WalletConnect
// projectId, which would otherwise crash the build's static generation
// pass even though the app runs fine once a real projectId is set.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-bg text-fg">
        <Providers>
          <AppNav />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
