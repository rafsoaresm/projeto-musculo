import { DemoShell } from "@/modules/demo/demo-shell";

export default function DemoGestorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DemoShell surface="gestor">{children}</DemoShell>;
}
