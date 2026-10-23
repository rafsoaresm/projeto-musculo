import { DemoShell } from "@/modules/demo/demo-shell";

export default function DemoAlunoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DemoShell surface="aluno">{children}</DemoShell>;
}
