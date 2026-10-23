import { DemoShell } from "@/modules/demo/demo-shell";

export default function DemoProfissionalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DemoShell surface="profissional">{children}</DemoShell>;
}
