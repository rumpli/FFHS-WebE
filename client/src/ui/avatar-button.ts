/**
 * avatar-button.ts
 *
 * Tiny avatar button placed in the HUD. Shows the current user's initial
 * (falls back to 'C' for guest) and emits navigation events when clicked.
 *
 * Events:
 * - `avatar:click` (bubbles) — a generic avatar interaction event.
 * - `nav:profile` (bubbles) — request navigation to the profile screen.
 */

import {state} from '../core/store.js';

customElements.define(
    "tl-avatar-button",
    class extends HTMLElement {
        private username: string | null = null;

        /** Called by the browser when the element is attached; we render and
         * register listeners for auth-related DOM events so the avatar updates
         * when the user logs in / out or the session is restored.
         */
        connectedCallback() {
            this.render();
            document.addEventListener('login:success', (e: any) => {
                try {
                    this.username = e.detail?.user?.username ?? null;
                    this.render();
                } catch {
                }
            });
            document.addEventListener('user:restored', (e: any) => {
                try {
                    this.username = e.detail?.user?.username ?? null;
                    this.render();
                } catch {
                }
            });
            document.addEventListener('auth:logout', () => {
                this.username = null;
                this.render();
            });
        }

        /** Ensure we have a username from the shared `state` object if available.
         * This is defensive: state may be populated by other startup code.
         */
        private ensureUsernameFromState() {

            try {
                const s = (state as any).userName || (state as any).username || null;
                if (s) this.username = String(s);
            } catch (e) {
            }
        }

        /** Render the button showing the user's initial and wire the click
         * handler that emits navigation events. Kept asynchronous to mirror
         * earlier patterns — no async work is performed here.
         */
        private async render() {
            this.ensureUsernameFromState();
            const initial = (this.username ? String(this.username.charAt(0)).toUpperCase() : 'C');
            this.innerHTML = `
        <button
          type="button"
          class="btn-top-r btn btn-secondary flex items-center justify-center w-9 h-9 rounded-full"
        >
          <span class="text-xs font-semibold text-gray-700">${initial}</span>
        </button>
      `;
            this.querySelector("button")?.addEventListener("click", (e) => {
                e.stopPropagation();
                this.dispatchEvent(new CustomEvent("avatar:click", {bubbles: true}));
                this.dispatchEvent(new CustomEvent("nav:profile", {bubbles: true}));
            });
        }
    }
);
