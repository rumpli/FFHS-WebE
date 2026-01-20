/**
 * collection-button.ts
 *
 * Small button element used in the HUD and home screen to open the
 * Collection view. Emits `collection:click` when activated.
 */

customElements.define(
    "tl-collection-button",
    class extends HTMLElement {
        connectedCallback() {
            this.render();
        }

        private render() {
            this.innerHTML = `
        <button type="button" class="btn btn-collection w-full">
          Collection
        </button>
      `;

            this.querySelector("button")?.addEventListener("click", (e) => {
                e.stopPropagation();
                this.dispatchEvent(
                    new CustomEvent("collection:click", {bubbles: true})
                );
            });
        }
    }
);
