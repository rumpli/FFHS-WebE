/**
 * lobby-create-screen.ts
 *
 * Screen for creating a new lobby. Posts to the API and navigates to the
 * lobby detail view on success.
 */

import {getToken} from "../auth/auth";

customElements.define(
    "lobby-create-screen",
    class extends HTMLElement {
        connectedCallback() {
            this.render();
        }

        private $(sel: string) {
            return this.querySelector(sel) as HTMLElement | null;
        }

        private render() {
            this.innerHTML = `
<div class="screens vh-100">
  <div class="home-center center-content">
    <h1 class="text-lg font-semibold mb-2">Create Lobby</h1>
    <div class="w-full max-w-md">
      <div class="card p-3 mb-2">
        <label class="text-xs text-gray-600">Max Players</label>
        <select id="maxPlayers" class="w-full mb-2">
          <option value="2">2</option>
        </select>
        <label class="text-xs text-gray-600">Code (optional)</label>
        <input id="code" class="w-full mb-2 input" placeholder="e.g. ABCD" />
        <div class="flex gap-2">
          <button id="btn-cancel" class="btn btn-secondary">Cancel</button>
          <button id="btn-create" class="btn btn-primary">Create</button>
        </div>
      </div>
    </div>
  </div>
  <app-footer></app-footer>
</div>
`;
            this.bind();
        }

        private bind() {

            this.$('#btn-cancel')?.addEventListener('click', () => this.dispatchEvent(new CustomEvent('nav:lobby', {
                bubbles: true,
                composed: true
            })));
            this.$('#btn-create')?.addEventListener('click', async () => {
                const API = (window as any).__CFG__.API_URL;
                if (!API) return;
                const token = getToken() ?? '';
                const maxPlayers = Number((this.$('#maxPlayers') as HTMLSelectElement).value || 2);
                const code = (this.$('#code') as HTMLInputElement).value || null;
                const res = await fetch(`${API}/lobbies`, {
                    method: 'POST',
                    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
                    body: JSON.stringify({maxPlayers, code})
                });
                const data = await res.json();
                if (res.ok && data?.ok) {
                    const root = document.getElementById('screen-root') as HTMLElement;
                    root.innerHTML = `<lobby-screen></lobby-screen>`;
                    customElements.whenDefined('lobby-screen').then(() => {
                        const el = root.querySelector('lobby-screen') as any;
                        if (el && typeof el.showLobbyDetail === 'function') el.showLobbyDetail(data?.lobby?.id);
                    });
                } else {
                    const m = document.createElement('info-modal') as any;
                    m.setAttribute('title', 'Create failed');
                    m.setAttribute('message', 'Failed to create lobby.');
                    document.body.appendChild(m);
                }
            });
        }
    }
);
