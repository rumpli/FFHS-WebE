/**
 * app-footer.ts
 *
 * Small app footer custom element used across screens.
 * Exposes a lightweight HTMLElement that renders a fixed footer with
 * copyright/branding text. No external attributes or public API.
 */

/**
 * App footer custom element
 * Renders a fixed footer bar with small, non-interactive copyright text.
 */
customElements.define(
    "app-footer",
    class extends HTMLElement {
        /** Called when the element is attached to the DOM. Renders inner HTML. */
        connectedCallback() {
            this.innerHTML = `
        <footer
          class="fixed bottom-2 left-0 right-0 text-center text-xs text-gray-500
                 opacity-70 select-none pointer-events-none">
          © TowerLords 2025
        </footer>
      `;
        }
    }
);
