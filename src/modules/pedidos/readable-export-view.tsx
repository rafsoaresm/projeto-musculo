import type { ReadableBlock, ReadableExport } from "./export-readable";

/** The readable copy (slice 0.91) on screen: draws `readableExport` as it is, section by section. */
function Block({ block }: { block: ReadableBlock }) {
  switch (block.kind) {
    case "subtitle":
      return <h3 className="copy-subtitle">{block.text}</h3>;
    case "heading":
      return <h4 className="copy-heading">{block.text}</h4>;
    case "text":
      return <p className={block.muted ? "muted small copy-text" : "copy-text"}>{block.text}</p>;
    case "list":
      return (
        <ul className="copy-list">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "facts":
      return (
        <dl className="copy-facts">
          {block.rows.map((row, index) => (
            <div key={`${row.label}-${index}`}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      );
  }
}

export function ReadableExportView({ readable }: { readable: ReadableExport }) {
  return (
    <div className="copy-document">
      <nav className="panel copy-index" aria-label="Seções da cópia">
        <p className="eyebrow">NESTA CÓPIA</p>
        <ol>
          {readable.sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>
                {section.eyebrow ? `${section.title} · ${section.eyebrow}` : section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {readable.sections.map((section) => (
        <section key={section.id} id={section.id} className="panel copy-section" aria-labelledby={`${section.id}-titulo`}>
          {section.eyebrow && <p className="eyebrow">{section.eyebrow}</p>}
          <h2 id={`${section.id}-titulo`}>{section.title}</h2>
          {section.blocks.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </section>
      ))}
    </div>
  );
}
