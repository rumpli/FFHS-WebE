/**
 * lobby-join-screen.ts
 *
 * UI for joining an existing lobby by code or id. Handles optional code
 * prompts and performs the join API call, then navigates to the lobby
 * detail view on success.
 */

import {getToken} from "../auth/auth";

customElements.define(
    "lobby-join-screen",
    class extends HTMLElement {
        connectedCallback() {
            this.render();
        }

        private $(s: string) {
            return this.querySelector(s) as HTMLElement | null;
        }

        private render() {
            this.innerHTML = `
<div class="screens vh-100">
  <div class="home-center center-content">
    <h1 class="text-lg font-semibold mb-2">Join Lobby</h1>
    <div class="w-full max-w-md">
      <div class="card p-3 mb-2">
        <label class="text-xs text-gray-600">Enter Lobby Code or ID</label>
        <input id="code" class="w-full mb-2 input" placeholder="Lobby code or id" />
        <div class="flex gap-2">
          <button id="btn-cancel" class="btn btn-secondary">Cancel</button>
          <button id="btn-join" class="btn btn-primary">Join</button>
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

            this.$('#btn-cancel')?.addEventListener('click', () => {
                try {
                    this.dispatchEvent(new CustomEvent('nav:lobby', {bubbles: true, composed: true}));
                } catch (e) {
                }
            });
            this.$('#btn-join')?.addEventListener('click', async () => {
                const API = (window as any).__CFG__.API_URL;
                if (!API) return;
                const token = getToken() ?? '';
                const codeOrId = (this.$('#code') as HTMLInputElement).value || '';
                const id = codeOrId.trim();
                if (!id) {
                    const m = document.createElement('info-modal') as any;
                    m.setAttribute('title', 'Enter lobby code');
                    m.setAttribute('message', 'Enter a lobby code or id');
                    document.body.appendChild(m);
                    return;
                }

                let lobby: any = null;
                try {
                    const headers: any = {};
                    if (token) headers.Authorization = `Bearer ${token}`;
                    const res = await fetch(`${API}/lobbies/${encodeURIComponent(id)}`, {headers});
                    if (res.ok) {
                        const d = await res.json();
                        lobby = d.lobby;
                    }
                } catch (e) {
                }

                if (!lobby) {
                    const m = document.createElement('info-modal') as any;
                    m.setAttribute('title', 'Lobby not found');
                    m.setAttribute('message', 'The requested lobby could not be found.');
                    document.body.appendChild(m);
                    return;
                }

                const inputMatchesCode = !!lobby.code && lobby.code === id;
                let providedCode: string | null = null;

                if (lobby.code && !inputMatchesCode) {
                    const prompt = document.createElement('code-prompt-modal') as any;
                    prompt.setAttribute('title', 'Enter Lobby Code');
                    prompt.setAttribute('placeholder', 'Lobby code');
                    document.body.appendChild(prompt);

                    const confirmed = await new Promise<{ value?: string, canceled?: boolean }>((resolve) => {
                        const onConfirm = (ev: any) => {
                            resolve({value: ev.detail.value});
                        };
                        const onCancel = () => {
                            resolve({canceled: true});
                        };
                        prompt.addEventListener('prompt:confirm', onConfirm, {once: true});
                        prompt.addEventListener('prompt:cancel', onCancel, {once: true});
                    });
                    if ((confirmed as any).canceled) return;
                    providedCode = (confirmed as any).value || null;
                    if (!providedCode) {
                        const m = document.createElement('info-modal') as any;
                        m.setAttribute('title', 'Code required');
                        m.setAttribute('message', 'A lobby code is required to join this lobby.');
                        document.body.appendChild(m);
                        return;
                    }
                } else if (lobby.code && inputMatchesCode) {
                    providedCode = lobby.code;
                }

                try {
                    const headers: any = {'Content-Type': 'application/json'};
                    if (token) headers.Authorization = `Bearer ${token}`;
                    const payload: any = {};
                    if (providedCode) payload.code = providedCode;
                    const joinRes = await fetch(`${API}/lobbies/${encodeURIComponent(lobby.id)}/join`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(payload)
                    });
                    const data = await joinRes.json().catch(() => ({}));
                    if (joinRes.ok && data?.ok) {
                        const root = document.getElementById('screen-root') as HTMLElement;
                        root.innerHTML = `<lobby-screen></lobby-screen>`;
                        customElements.whenDefined('lobby-screen').then(() => {
                            const el = root.querySelector('lobby-screen') as any;
                            if (el && typeof el.showLobbyDetail === 'function') el.showLobbyDetail(data?.lobby?.id);
                        });
                        return;
                    } else {
                        const m = document.createElement('info-modal') as any;
                        m.setAttribute('title', 'Join failed');
                        m.setAttribute('message', 'Failed to join lobby: ' + (data.error ?? 'unknown'));
                        document.body.appendChild(m);
                        return;
                    }
                } catch (e) {
                    const m = document.createElement('info-modal') as any;
                    m.setAttribute('title', 'Join failed');
                    m.setAttribute('message', 'Failed to join lobby.');
                    document.body.appendChild(m);
                    return;
                }
            });
        }
    }
);
