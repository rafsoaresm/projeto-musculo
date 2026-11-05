import type { Metadata } from "next";
import "@fontsource/figtree/latin-400.css";
import "@fontsource/figtree/latin-700.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-700.css";
import "./globals.css";
import "../styles/fig-ap.css";
import "../styles/fig-gen.css";
import "../styles/fig-rx.css";

export const metadata: Metadata = {
  title: {
    default: "Trainer Prescription",
    template: "%s · Trainer Prescription",
  },
  description:
    "Planejamento e acompanhamento para profissionais de treinamento.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
