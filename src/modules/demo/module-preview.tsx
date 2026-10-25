import { Notice, PageHeading, Pill } from "@/components/ui";

/**
 * A module that works in the real area but has no fictional data in the demonstration. It says what
 * the real page offers and invents no record, number or name.
 */
export function ModulePreview({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <PageHeading
        eyebrow={eyebrow}
        title={title}
        description={description}
        aside={<Pill tone="warning">Prévia · sem dados</Pill>}
      />
      <Notice>
        <p>{children}</p>
      </Notice>
    </>
  );
}
