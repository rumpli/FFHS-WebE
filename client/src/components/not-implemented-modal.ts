/**
 * not-implemented-modal.ts
 *
 * Simple modal used as a placeholder for features that aren't implemented yet.
 */

customElements.define(
    "not-implemented-modal",
    class extends HTMLElement {
        connectedCallback() {
            this.className =
                "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm";
            this.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl max-w-sm w-[90%] p-6 text-center">
          <h2 class="text-xl font-semibold mb-3 text-gray-800">
            Coming soon!
          </h2>

          <p class="text-gray-600 mb-6">
            This function is currently not implemented.
          </p>

          <div class="flex justify-center">
            <button id="close-btn" type="button" class="btn btn-primary">
              Back
            </button>
          </div>
        </div>
      `;
            this.querySelector("#close-btn")?.addEventListener("click", () => {
                this.remove();
            });
        }
    }
);
