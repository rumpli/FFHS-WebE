/**
 * logout-button.ts
 *
 * Simple logout button used in the HUD. Emits `logout:click` when activated;
 * other parts of the app listen for this event to perform the actual logout
 * workflow (clearing tokens, calling the API, etc.).
 */

customElements.define(
    "tl-logout-button",
    class extends HTMLElement {
        connectedCallback() {
            this.render();
        }

        private render() {
            this.innerHTML = `
        <button type="button" class="btn btn-secondary">
          Logout
        </button>
      `;

            this.querySelector("button")?.addEventListener("click", (e) => {
                e.stopPropagation();
                this.dispatchEvent(
                    new CustomEvent("logout:click", {bubbles: true})
                );
            });
        }
    }
);
