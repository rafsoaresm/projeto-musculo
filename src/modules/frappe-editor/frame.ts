/**
 * The frame of the Editor Avançado (handoff V4, Figma `10:218`, AC19.1): a thin bar above the Frappe Builder with the title, the trail
 * "Frappe Builder / Site profissional / <situação>" and "Voltar ao Meu Site". The editor's own area is not redrawn (the frame says so):
 * the bar sits outside the editor's root, which is moved down by the bar's height. The way back is worked out in the page from
 * `window.builder_path` (set by the shell from the mount path), so it is right under any mount.
 */
export const EDITOR_BAR_HEIGHT = 48;

export function withEditorFrame(shell: string, live: boolean): string {
  const situation = live ? "Publicado" : "Rascunho";
  const frame = `
<style>
#tp-editor-bar{position:fixed;top:0;left:0;right:0;height:${EDITOR_BAR_HEIGHT}px;z-index:2147483000;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 16px;box-sizing:border-box;background:#fff;border-bottom:1px solid #d8dcdf;font:14px/1.3 Figtree,system-ui,sans-serif;color:#1f2933}
#tp-editor-bar .tp-title{display:flex;align-items:baseline;gap:12px;min-width:0;overflow:hidden;white-space:nowrap}
#tp-editor-bar strong{font-size:16px}
#tp-editor-bar nav{color:#56606a;font-size:12px;overflow:hidden;text-overflow:ellipsis}
#tp-editor-back{flex-shrink:0;background:#eef0f1;border-radius:999px;padding:6px 14px;color:#1f2933;text-decoration:none;font-weight:700}
#tp-editor-back:focus-visible{outline:2px solid #0078b8;outline-offset:2px}
#app{position:fixed;top:${EDITOR_BAR_HEIGHT}px;left:0;right:0;bottom:0;overflow:hidden;transform:translateZ(0)}
#app .h-screen{height:calc(100vh - ${EDITOR_BAR_HEIGHT}px)!important}
@media (max-width:480px){#tp-editor-bar nav{display:none}}
</style>
<div id="tp-editor-bar" role="banner">
<div class="tp-title"><strong>Editor Avançado</strong><nav aria-label="Trilha">Frappe Builder / Site profissional / ${situation}</nav></div>
<a id="tp-editor-back" href="#">Voltar ao Meu Site</a>
</div>
<script>
(function () {
  var back = document.getElementById("tp-editor-back");
  if (back && window.builder_path) back.href = window.builder_path.replace(/\\/editor$/, "");
})();
</script>`;
  return shell.replace(/<body([^>]*)>/, (open) => open + frame);
}
