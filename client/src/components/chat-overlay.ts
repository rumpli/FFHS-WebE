/**
 * chat-overlay.ts
 *
 * Small overlay that places a `chat-panel` on top of the UI and a toggle/help
 * button. Hooks into the app `bus` and chat state to show unread counts.
 */

import "./chat-panel";
import "./help-button";
import {bus} from "../core/EventBus";
import {state} from "../core/store";
import {loadChatUi} from "../core/chatPersist";
import {chatHistoryRequest} from "../core/ws";

customElements.define("chat-overlay", class extends HTMLElement {
    private open = false;
    private offUnread?: () => void;

    private onAudioPanel = (e: Event) => {
        const ev = e as CustomEvent<{ open?: boolean }>;
        const isAudioOpen = !!ev.detail?.open;

        // Hide behind audio when audio panel is open
        this.$("#btn-open")?.classList.toggle("hidden-behind-audio", isAudioOpen && !this.open);
        this.$("help-button")?.classList.toggle("hidden-behind-audio", isAudioOpen && !this.open);
    };

    connectedCallback() {
        this.renderOnce();
        this.bindOnce();

        try {
            const sid = state.chat.id || state.matchId || '';
            if (sid) {
                const restored = loadChatUi(state.chat.scope, sid);
                if (restored) {
                    state.chat.unreadCount = Math.max(0, restored.unreadCount);
                }
            }
        } catch {
        }
        this.open = state.chat.isOpen;
        this.applyOpen();
        document.addEventListener("audio-panel", this.onAudioPanel as EventListener);
        const handler = (p: any) => this.updateUnreadDot(Number(p?.unread ?? 0));
        bus.on("chat:unread", handler);
        this.offUnread = () => bus.off("chat:unread", handler);
        this.updateUnreadDot(state.chat.unreadCount);
    }

    disconnectedCallback() {
        document.removeEventListener("audio-panel", this.onAudioPanel as EventListener);
        this.offUnread?.();
        this.offUnread = undefined;
    }

    private $(sel: string) {
        return this.querySelector(sel) as HTMLElement | null;
    }

    private renderOnce() {
        this.innerHTML = `
<div class="chat-overlay-wrap flex items-center">
  <help-button></help-button>
  
  <button id="btn-open"
    type="button"
    class="relative btn text-xs px-3 py-2 shadow-md border border-gray-200 bg-white/90 backdrop-blur-sm">
    Chat
    <span id="dot" class="hidden absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500"></span>
  </button>

  <div id="panel"
       class="hidden bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col
              w-[80vw] max-w-sm h-[55vh] max-h-[480px]
              sm:w-80 sm:h-96">
    <div class="px-3 py-2 border-b border-gray-100 bg-gray-50 flex items-center justify-between flex-none">
      <span class="text-xs font-semibold text-gray-700">Match Chat</span>
      <button id="btn-close" type="button" class="text-xs px-2 py-1 rounded hover:bg-gray-200">×</button>
    </div>
    <chat-panel class="flex-1 min-h-0"></chat-panel>
  </div>
</div>
`;
    }

    private bindOnce() {
        // open
        this.$("#btn-open")?.addEventListener("click", () => {
            this.open = true;
            state.chat.isOpen = true;
            // Request chat history without joining/rejoining the match.
            try {
                if (state.matchId) chatHistoryRequest(state.matchId);
            } catch {
            }
            this.applyOpen();
            setTimeout(() => {
                const panel = this.querySelector('chat-panel') as any;
                try {
                    if (panel && typeof panel.onOverlayOpened === 'function') {
                        panel.onOverlayOpened();
                    }
                    (panel?.querySelector?.('#msg') as HTMLInputElement | null)?.focus?.();
                } catch {
                }
            }, 0);
        });

        this.$("#btn-close")?.addEventListener("click", () => {
            this.open = false;
            state.chat.isOpen = false;
            this.applyOpen();
        });

        document.addEventListener("pointerdown", (ev) => {
            if (!this.open) return;
            if (ev.composedPath().includes(this)) return;
            this.open = false;
            state.chat.isOpen = false;
            this.applyOpen();
        }, {passive: true});
    }

    /**
     * For use by the audio panel to indicate when it is open.
     * @param open True if the audio overlay is open.
     */
    public setAudioOverlayOpen(open: boolean) {
        this.$("#btn-open")?.classList.toggle("hidden-behind-audio", open && !this.open);
        this.$("help-button")?.classList.toggle("hidden-behind-audio", open && !this.open);
    }

    private applyOpen() {
        this.$("#panel")?.classList.toggle("hidden", !this.open);
        this.$("#btn-open")?.classList.toggle("hidden", this.open);
        this.updateUnreadDot(state.chat.unreadCount);
    }

    private updateUnreadDot(unread: number) {
        const dot = this.$("#dot");
        if (!dot) return;
        dot.classList.toggle("hidden", this.open || unread <= 0);
    }

    /**
     * Toggle the chat panel open or closed.
     */
    public toggleChat() {
        this.open = !this.open;
        state.chat.isOpen = this.open;
        if (this.open) {
            try {
                if (state.matchId) chatHistoryRequest(state.matchId);
            } catch {
            }
            this.applyOpen();
            setTimeout(() => {
                const panel = this.querySelector('chat-panel') as any;
                try {
                    if (panel && typeof panel.onOverlayOpened === 'function') {
                        panel.onOverlayOpened();
                    }
                    (panel?.querySelector?.('#msg') as HTMLInputElement | null)?.focus?.();
                } catch {
                }
            }, 0);
            return;
        }
        this.applyOpen();
    }
});
