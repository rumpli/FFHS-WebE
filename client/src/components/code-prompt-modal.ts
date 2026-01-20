/**
 * code-prompt-modal.ts
 *
 * Minimal prompt modal used to collect short text input from the user.
 * Emits `prompt:confirm` with detail { value } on confirm and `prompt:cancel`
 * on cancel.
 */

customElements.define(
    "code-prompt-modal",
    class extends HTMLElement {
        connectedCallback() {
            this.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm";
            const title = this.getAttribute('title') || 'Enter code';
            const placeholder = this.getAttribute('placeholder') || '';
            const confirmText = this.getAttribute('confirm-text') || 'Join';
            const cancelText = this.getAttribute('cancel-text') || 'Cancel';

            this.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl max-w-sm w-[90%] p-6">
          <h2 class="text-xl font-semibold mb-3 text-gray-800">${title}</h2>

          <div class="mb-4">
            <input id="code-input" class="w-full input" placeholder="${placeholder}" />
          </div>

          <div class="flex justify-end gap-2">
            <button id="cancel-btn" type="button" class="btn btn-secondary">${cancelText}</button>
            <button id="confirm-btn" type="button" class="btn btn-primary">${confirmText}</button>
          </div>
        </div>
      `;

            const remove = () => this.remove();
            this.querySelector('#cancel-btn')?.addEventListener('click', () => {
                this.dispatchEvent(new CustomEvent('prompt:cancel', {bubbles: true}));
                remove();
            });
            this.querySelector('#confirm-btn')?.addEventListener('click', () => {
                const val = (this.querySelector('#code-input') as HTMLInputElement)?.value || '';
                this.dispatchEvent(new CustomEvent('prompt:confirm', {detail: {value: val}, bubbles: true}));
                remove();
            });

            setTimeout(() => {
                (this.querySelector('#code-input') as HTMLInputElement | null)?.focus();
            }, 0);
        }
    }
);
