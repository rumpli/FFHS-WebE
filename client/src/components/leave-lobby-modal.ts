/**
 * leave-lobby-modal.ts
 *
 * Confirmation modal shown when a player attempts to leave a lobby.
 */

customElements.define(
    "leave-lobby-modal",
    class extends HTMLElement {
        connectedCallback() {
            this.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm";
            this.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl max-w-sm w-[90%] p-6 text-center">
      <h2 class="text-lg font-semibold mb-3 text-gray-800">Leave Lobby?</h2>
      <p class="text-gray-600 mb-6">If you leave the lobby, the lobby will be closed if you're the host. Do you want to leave?</p>
      <div class="flex justify-center gap-3">
        <button id="btn-cancel" type="button" class="btn btn-secondary">Cancel</button>
        <button id="btn-leave" type="button" class="btn btn-primary">Leave</button>
      </div>
    </div>
  `;

            this.querySelector("#btn-cancel")?.addEventListener("click", () => {
                this.dispatchEvent(new CustomEvent('leave:cancel', {bubbles: true}));
                this.remove();
            });
            this.querySelector("#btn-leave")?.addEventListener("click", () => {
                this.dispatchEvent(new CustomEvent('leave:confirm', {bubbles: true}));
                this.remove();
            });
        }
    }
);
