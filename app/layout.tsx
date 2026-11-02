import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  // Base das URLs absolutas de Open Graph; as paginas do portal sobrescrevem com o dominio da cidade.
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || siteConfig.links.portal),
  title: siteConfig.title,
  description: siteConfig.description,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="h-full bg-background text-foreground antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
