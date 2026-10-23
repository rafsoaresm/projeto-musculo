import Link from "next/link";
import { PublicShell } from "@/components/public-shell";

// Static frame: "/acesso" sends anyone without a session to the sign-in page.
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PublicShell
      actions={
        <Link className="button secondary small" href="/acesso">
          Acessar minha área
        </Link>
      }
    >
      {children}
    </PublicShell>
  );
}
