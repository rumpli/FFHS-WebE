/**
 * shop-button.ts
 *
 * Small floating button used to open the shop. Emits `shop:click` when
 * activated. Kept intentionally minimal; UI logic is handled by listeners
 * elsewhere in the app.
 */

customElements.define(
    "tl-shop-button",
    class extends HTMLElement {
        connectedCallback() {
            this.render();
        }

        private render() {
            this.innerHTML = `
        <button type="button" class="btn btn-special btn-bot-l">
          Shop
        </button>
      `;

            this.querySelector("button")?.addEventListener("click", (e) => {
                e.stopPropagation();
                this.dispatchEvent(
                    new CustomEvent("shop:click", {bubbles: true})
                );
            });
        }
    }
);
