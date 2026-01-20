/**
 * help-button.ts
 *
 * Small toolbar button that opens the `help-modal` when clicked and emits a
 * UI bus event. Lightweight wrapper to centralize modal creation and focus.
 */


import "./help-modal";
import {bus} from "../core/EventBus";
import {error} from "../core/log";

customElements.define("help-button", class extends HTMLElement {
    constructor() {
        super();
        this.render();
    }

    connectedCallback() {
        this.bind();
    }

    disconnectedCallback() {
        try {
            this.$('#btn-help')?.removeEventListener('click', this.onClick);
        } catch (e) {
        }
    }

    private $(sel: string) {
        return this.querySelector(sel) as HTMLElement | null;
    }

    private onClick = () => {
        try {
            const modal = document.createElement('help-modal') as any;
            document.body.appendChild(modal);
            setTimeout(() => {
                try {
                    (modal.querySelector('.help-modal-inner') as HTMLElement | null)?.focus();
                } catch (e) {
                }
            }, 50);
            try {
                bus.emit('ui:help-open', null);
            } catch (e) {
            }
        } catch (err) {
            try {
                error('help-button: failed to open modal', err);
            } catch (e) {
            }
        }
    }

    private bind() {
        this.$('#btn-help')?.addEventListener('click', this.onClick);
    }

    private render() {
        this.innerHTML = `
<button id="btn-help" type="button" class="relative btn px-3 py-2 mr-2.5 border border-gray-200 bg-white/90 backdrop-blur-sm" aria-label="Help">?
</button>
`;
    }
});
