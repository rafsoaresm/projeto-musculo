"use client";

/** The event the management page listens to: open the guided editor without reloading the page. */
export const EDIT_SITE_EVENT = "meu-site:editar";

/**
 * "Editar site" in the header (Figma 10:76). A link to the same page with `?editar=1` did nothing once the page was on the screen, because the
 * workspace was already mounted (the user's report of 01/11/2026): the button asks the workspace directly. The link stays for a fresh load.
 */
export function EditSiteButton() {
  return (
    <a
      className="button primary"
      href="?editar=1"
      onClick={(event) => {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(EDIT_SITE_EVENT));
      }}
    >
      Editar site
    </a>
  );
}
