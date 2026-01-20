/**
 * info-modal.ts
 *
 * Generic information modal. Attributes supported: `title`, `message`, `ok-text`.
 */

customElements.define(
    "info-modal",
    class extends HTMLElement {
        connectedCallback() {
            this.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm";
            const title = this.getAttribute('title') || 'Info';
            const message = this.getAttribute('message') || '';
            const okText = this.getAttribute('ok-text') || 'OK';

            this.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl max-w-sm w-[90%] p-6 text-center">
          <h2 class="text-xl font-semibold mb-3 text-gray-800">${title}</h2>

          <p class="text-gray-600 mb-6">${message}</p>

          <div class="flex justify-center">
            <button id="close-btn" type="button" class="btn btn-primary">${okText}</button>
          </div>
        </div>
      `;

            this.querySelector("#close-btn")?.addEventListener("click", () => {
                this.remove();
            });
        }
    }
);
