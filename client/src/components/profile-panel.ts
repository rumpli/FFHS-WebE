/**
 * profile-panel.ts
 *
 * On-demand profile overlay that can include a `match-sidebar` when opened
 * from inside a match. Provides close and cleanup behavior for attached
 * event handlers.
 */

import {state} from "../core/store";
import {bus} from "../core/EventBus";

class ProfilePanel extends HTMLElement {
    private overlay: HTMLDivElement | null = null;
    private offReqEnd?: () => void;
    private offReqForfeit?: () => void;

    connectedCallback() {
    }

    open(opts: { includeMatchSidebar?: boolean } = {}) {
        try {
            this.close();
            const includeSidebar = !!opts.includeMatchSidebar;

            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 z-50 flex items-start justify-end p-6 overlay-blur';
            overlay.style.pointerEvents = 'auto';

            const container = document.createElement('div');
            container.className = 'bg-white rounded-2xl shadow-xl border border-gray-200 overflow-auto';
            container.style.width = '360px';
            container.style.maxHeight = '80vh';
            container.style.padding = '12px';

            const header = document.createElement('div');
            header.className = 'flex items-center justify-between mb-3';
            const title = document.createElement('div');
            title.className = 'text-sm font-semibold';
            title.textContent = 'Profile';
            const closeBtn = document.createElement('button');
            closeBtn.className = 'text-xs text-gray-500';
            closeBtn.textContent = 'Close';
            closeBtn.addEventListener('click', () => this.close());
            header.appendChild(title);
            header.appendChild(closeBtn);

            const body = document.createElement('div');
            body.className = 'space-y-2 text-sm text-gray-700';

            const name = document.createElement('div');
            const username = (state.matchState?.playersSummary || []).find((p: any) => String(p.userId) === String(state.userId))?.username ?? 'You';
            name.innerHTML = `<div class="font-semibold">${username}</div>`;

            body.appendChild(name);

            container.appendChild(header);
            container.appendChild(body);

            if (includeSidebar) {
                const sidebar = document.createElement('match-sidebar') as any;
                try {
                    (sidebar as any).match = state.matchState;
                } catch (e) {
                }
                const wrapper = document.createElement('div');
                wrapper.style.marginTop = '10px';
                wrapper.appendChild(sidebar);
                container.appendChild(wrapper);
                try {
                    const onEnd = (p: any) => {
                        if (!p || String(p.matchId) !== String(state.matchId)) return;
                        this.close();
                    };
                    const onForfeit = (p: any) => {
                        if (!p || String(p.matchId) !== String(state.matchId)) return;
                        this.close();
                    };
                    bus.on('match:request-end-round', onEnd);
                    bus.on('match:request-forfeit', onForfeit);
                    this.offReqEnd = () => bus.off('match:request-end-round', onEnd);
                    this.offReqForfeit = () => bus.off('match:request-forfeit', onForfeit);
                } catch (e) {
                }
            }

            overlay.appendChild(container);

            overlay.addEventListener('click', (ev) => {
                if (ev.target === overlay) this.close();
            });

            document.body.appendChild(overlay);
            this.overlay = overlay;
        } catch (e) {
        }
    }

    close() {
        try {
            if (this.overlay) {
                this.overlay.remove();
                this.overlay = null;
                try {
                    this.offReqEnd?.();
                    this.offReqForfeit?.();
                } catch (e) {
                }
            }
        } catch (e) {
        }
    }
}

customElements.define('profile-panel', ProfilePanel);
export default ProfilePanel;
