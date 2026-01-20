/**
 * searching-screen.ts
 *
 * UI shown while matchmaking is in progress. Listens for websocket messages
 * about matchmaking state and emits navigation events when a match is found.
 */

import "../components/app-footer";
import {bus} from "../core/EventBus";
import {
    cancelMatchmaking,
    matchReadyConfirm,
} from "../core/ws";

customElements.define(
    "searching-screen",
    class extends HTMLElement {
        private offWs?: () => void;

        connectedCallback() {
            this.render();
            this.bind();
            this.setStatus("Please wait while we find a match for you.");
            this.setButtons({cancelDisabled: false});
        }

        disconnectedCallback() {
            this.offWs?.();
            this.offWs = undefined;
        }

        private render() {
            this.innerHTML = `
<div class="screens vh-100">
  <div class="center-content">
    <div class="screen-limit flex flex-col items-center gap-6">
      <div class="flex flex-col items-center gap-2">
        <h1 class="text-lg font-semibold text-gray-800">
          Searching for opponents…
        </h1>
        <p id="status-text" class="text-xs text-gray-500 text-center max-w-xs">
          Please wait while we find a match for you.
        </p>
        <p id="match-id" class="text-[11px] text-gray-400"></p>
      </div>

      <div class="flex items-center gap-2" aria-hidden="true">
        <span class="inline-block w-2 h-2 rounded-full bg-gray-400 animate-pulse"></span>
        <span class="inline-block w-2 h-2 rounded-full bg-gray-400 animate-pulse [animation-delay:150ms]"></span>
        <span class="inline-block w-2 h-2 rounded-full bg-gray-400 animate-pulse [animation-delay:300ms]"></span>
      </div>

      <div class="flex items-center gap-2 mt-2">
        <button id="btn-cancel" type="button" class="btn btn-secondary">
          Cancel
        </button>
      </div>
    </div>
  </div>

  <app-footer></app-footer>
</div>
`;
        }

        private $(sel: string) {
            return this.querySelector(sel) as HTMLElement | null;
        }

        private setStatus(text: string) {
            const el = this.$("#status-text");
            if (el) el.textContent = text;
        }

        private setMatchIdText(matchId: string | null) {
            const el = this.$("#match-id");
            if (!el) return;
            el.textContent = matchId ? `matchId: ${matchId}` : "";
        }

        private setButtons(opts: { cancelDisabled: boolean }) {
            const cancel = this.$("#btn-cancel") as HTMLButtonElement | null;
            if (cancel) cancel.disabled = opts.cancelDisabled;
        }

        private bind() {
            this.$("#btn-cancel")?.addEventListener("click", () => {
                cancelMatchmaking();
                this.setStatus("Cancelling…");
                this.setButtons({cancelDisabled: true});
                this.dispatchEvent(
                    new CustomEvent("matchmaking:cancel", {bubbles: true}),
                );
            });

            const statusEl = this.$("#status-text") as HTMLElement | null;

            let currentMatchId: string | null = null;

            const handler = (msg: any) => {
                if (!msg || typeof msg !== "object") return;
                switch (msg.type) {
                    case "MATCH_WAITING": {
                        currentMatchId = msg.matchId ?? currentMatchId;
                        if (statusEl) {
                            statusEl.textContent =
                                "In queue… waiting for an opponent.";
                        }
                        break;
                    }

                    case "MATCH_LOBBY": {
                        currentMatchId = msg.matchId ?? currentMatchId;
                        if (!currentMatchId) return;

                        if (statusEl) {
                            statusEl.textContent =
                                "Opponent found! Confirming ready…";
                        }


                        matchReadyConfirm(currentMatchId);
                        break;
                    }

                    case "MATCH_READY": {
                        const matchId = msg.matchId as string | undefined;
                        if (!matchId) return;

                        if (statusEl) {
                            statusEl.textContent = "Match ready! Starting…";
                        }

                        this.dispatchEvent(
                            new CustomEvent("matchmaking:found", {
                                bubbles: true,
                                detail: {matchId},
                            }),
                        );
                        break;
                    }
                }
            };
            bus.on("ws:msg", handler);
            this.offWs = () => bus.off("ws:msg", handler);
        }
    },
);
