/**
 * chat-panel.ts
 *
 * In-match chat panel component. Handles rendering of messages, scroll
 * behaviour, unread message divider and sending messages over the websocket.
 */

import {bus} from "../core/EventBus";
import {state} from "../core/store";
import {chatSend, getWsState} from "../core/ws";
import {loadChatUi, persistReadNow, persistUnread} from "../core/chatPersist";

type ChatItem = {
    userId: string;
    username?: string | null;
    text: string;
    ts: number;
};

customElements.define(
    "chat-panel",
    class extends HTMLElement {
        private offMsg?: () => void;
        private offStatus?: () => void;
        private connected = false;
        private isAtBottom = true;
        private restoredLastReadTs: number | null = null;
        private firstUnreadTs: number | null = null;

        connectedCallback() {
            this.render();
            this.bind();
            try {
                const sid = state.chat.id || state.matchId || '';
                if (sid) {
                    const restored = loadChatUi(state.chat.scope, sid);
                    if (restored) {
                        state.chat.unreadCount = Math.max(0, restored.unreadCount);
                        this.restoredLastReadTs = typeof restored.lastReadTs === 'number' ? restored.lastReadTs : null;
                        bus.emit('chat:unread', {unread: state.chat.unreadCount});
                    }
                }
            } catch {
            }

            this.offStatus = bus.on("ws:status", (s: any) => {
                const st = s?.state ?? "unknown";
                this.connected = st === "connected";
                this.updateStatus(st);
                this.setSendEnabled(this.connected);
            });

            const handler = (m: any) => this.onWsMsg(m);
            bus.on("ws:msg", handler);
            this.offMsg = () => bus.off("ws:msg", handler);

            const st = getWsState();
            this.connected = st === "connected";
            this.updateStatus(st);
            this.setSendEnabled(this.connected);

            const list = this.$list();
            list?.addEventListener("scroll", () => this.onScroll());

            this.setHistory(state.chat.messages);

            if (state.chat.isOpen && this.isAtBottom) {
                state.chat.unreadCount = 0;
                bus.emit("chat:unread", {unread: 0});
                persistReadNow();
            } else {
                persistUnread();
            }
        }

        disconnectedCallback() {
            this.offStatus?.();
            this.offStatus = undefined;

            this.offMsg?.();
            this.offMsg = undefined;
        }

        private $(sel: string) {
            return this.querySelector(sel) as HTMLElement | null;
        }

        private $input() {
            return this.querySelector("#msg") as HTMLInputElement | null;
        }

        private $list() {
            return this.querySelector("#list") as HTMLElement | null;
        }

        private $status() {
            return this.querySelector("#status") as HTMLElement | null;
        }

        private bind() {
            this.$("#send")?.addEventListener("click", () => this.sendFromInput());
            this.$input()?.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    this.sendFromInput();
                }
            });

            this.$("#jump-new")?.addEventListener("click", () => {
                this.scrollToBottom();
                this.isAtBottom = true;
                this.removeNewMessagesDivider();
                state.chat.unreadCount = 0;
                bus.emit("chat:unread", {unread: 0});
                persistReadNow();
                this.updateJumpBar();
            });
        }

        private updateStatus(s: string) {
            const el = this.$status();
            if (!el) return;
            el.textContent = `ws: ${s}`;
            this.setSendEnabled(s === "connected");
        }

        private setSendEnabled(on: boolean) {
            const btn = this.querySelector("#send") as HTMLButtonElement | null;
            if (!btn) return;
            btn.disabled = !on;
            btn.classList.toggle("opacity-60", !on);
            btn.classList.toggle("cursor-not-allowed", !on);
        }

        private onScroll() {
            const list = this.$list();
            if (!list) return;

            const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 8;
            this.isAtBottom = nearBottom;

            if (nearBottom) {
                this.removeNewMessagesDivider();
                state.chat.unreadCount = 0;
                bus.emit("chat:unread", {unread: 0});
                persistReadNow();
            }
            this.updateJumpBar();
        }

        private setHistory(items: ChatItem[]) {
            const list = this.$list();
            if (!list) return;

            state.chat.messages = [...(items ?? [])];

            list.innerHTML = "";
            this.hasNewDivider = false;

            // Compute first unread timestamp from lastReadTs.
            const lastReadTs = this.restoredLastReadTs;
            this.firstUnreadTs = null;
            if (typeof lastReadTs === 'number') {
                const first = state.chat.messages.find((m) => Number(m.ts) > lastReadTs);
                if (first) this.firstUnreadTs = Number(first.ts);
            }

            let insertedDivider = false;

            for (const it of state.chat.messages) {
                const isUnread = this.firstUnreadTs !== null && Number(it.ts) >= this.firstUnreadTs;
                if (!insertedDivider && this.firstUnreadTs !== null && Number(it.ts) === this.firstUnreadTs) {
                    // Insert divider right before the first unread message.
                    const wrap = this.renderMsgReturnWrap(it, false, isUnread);
                    if (wrap) {
                        this.insertNewMessagesDividerBefore(wrap);
                        insertedDivider = true;
                    }
                    continue;
                }
                this.renderMsg(it, false, isUnread);
            }

            // Decide whether to auto-scroll:
            // - if chat is open AND already at bottom -> keep it pinned to bottom
            // - if chat is closed -> keep at bottom (typical UX when opening later)
            // - otherwise preserve user's scroll position (don't jerk them)
            const shouldAutoScroll = !state.chat.isOpen || this.isAtBottom;
            // If chat is open and we have unread messages (divider exists), don't auto-scroll to bottom.
            const hasUnreadDivider = !!this.querySelector(`#${this.dividerId}`);
            if (shouldAutoScroll && !(state.chat.isOpen && hasUnreadDivider)) {
                this.scrollToBottom();
                this.isAtBottom = true;
            }

            this.updateJumpBar();
        }

        private renderMsg(it: ChatItem, autoScroll: boolean, isUnread = false) {
            const list = this.$list();
            if (!list) return;

            const mine = it.userId === state.userId;

            const wrap = document.createElement("div");
            wrap.className = `flex ${mine ? "justify-end" : "justify-start"}`;

            const bubble = document.createElement("div");
            bubble.className =
                "max-w-[95%] rounded-2xl px-3 py-1.5 text-xs leading-snug border " +
                (mine
                    ? "bg-sky-600 text-white border-sky-600"
                    : "bg-white text-gray-800 border-gray-200");

            const header = document.createElement("div");
            header.className = "flex items-baseline justify-between gap-2 mb-0.5";

            const left = document.createElement("div");
            left.className = "flex items-baseline gap-2";

            const displayName = mine ? "You" : it.username || `User ${it.userId.slice(0, 8)}`;
            const nameEl = document.createElement("span");
            nameEl.className =
                "text-[10px] font-medium " + (mine ? "text-blue-100" : "text-gray-500");
            nameEl.textContent = displayName;
            left.appendChild(nameEl);

            if (!mine && isUnread && !this.isAtBottom) {
                const badge = document.createElement('span');
                badge.className = 'text-[9px] px-1.5 py-[1px] rounded bg-red-100 text-red-700 border border-red-200';
                badge.textContent = 'NEW';
                left.appendChild(badge);
            }

            const tsEl = document.createElement("span");
            tsEl.className = "text-[10px] " + (mine ? "text-blue-100" : "text-gray-400");
            tsEl.textContent = new Date(it.ts).toLocaleTimeString();

            header.appendChild(left);
            header.appendChild(tsEl);

            const body = document.createElement("div");
            body.className = "whitespace-pre-wrap break-words";
            body.textContent = it.text;

            bubble.appendChild(header);
            bubble.appendChild(body);
            wrap.appendChild(bubble);
            list.appendChild(wrap);

            if (autoScroll) {
                this.scrollToBottom();
                this.isAtBottom = true;
            }
        }

        private renderMsgReturnWrap(it: ChatItem, autoScroll: boolean, isUnread = false): HTMLElement | null {
            const list = this.$list();
            if (!list) return null;

            const mine = it.userId === state.userId;

            const wrap = document.createElement("div");
            wrap.className = `flex ${mine ? "justify-end" : "justify-start"}`;

            const bubble = document.createElement("div");
            bubble.className =
                "max-w-[95%] rounded-2xl px-3 py-1.5 text-xs leading-snug border " +
                (mine
                    ? "bg-sky-600 text-white border-sky-600"
                    : "bg-white text-gray-800 border-gray-200");

            const header = document.createElement("div");
            header.className = "flex items-baseline justify-between gap-2 mb-0.5";

            const left = document.createElement("div");
            left.className = "flex items-baseline gap-2";

            const displayName = mine ? "You" : it.username || `User ${it.userId.slice(0, 8)}`;

            const nameEl = document.createElement("span");
            nameEl.className =
                "text-[10px] font-medium " + (mine ? "text-blue-100" : "text-gray-500");
            nameEl.textContent = displayName;
            left.appendChild(nameEl);

            if (!mine && isUnread && !this.isAtBottom) {
                const badge = document.createElement('span');
                badge.className = 'text-[9px] px-1.5 py-[1px] rounded bg-red-100 text-red-700 border border-red-200';
                badge.textContent = 'NEW';
                left.appendChild(badge);
            }

            const tsEl = document.createElement("span");
            tsEl.className = "text-[10px] " + (mine ? "text-blue-100" : "text-gray-400");
            tsEl.textContent = new Date(it.ts).toLocaleTimeString();

            header.appendChild(left);
            header.appendChild(tsEl);

            const body = document.createElement("div");
            body.className = "whitespace-pre-wrap break-words";
            body.textContent = it.text;

            bubble.appendChild(header);
            bubble.appendChild(body);
            wrap.appendChild(bubble);
            list.appendChild(wrap);

            if (autoScroll) {
                this.scrollToBottom();
                this.isAtBottom = true;
            }
            return wrap;
        }

        /**
         * Handle the chat overlay being opened.
         * Scrolls to the last unread message if it exists, otherwise to the bottom.
         */
        public onOverlayOpened() {
            try {
                const list = this.$list();
                if (!list) return;
                const divider = this.querySelector(`#${this.dividerId}`) as HTMLElement | null;
                if (divider) {
                    const dividerTop = divider.offsetTop;
                    const padding = 12;
                    list.scrollTop = Math.max(0, dividerTop - padding);
                    this.isAtBottom = false;
                    this.updateJumpBar();
                    return;
                }
                this.scrollToBottom();
                this.isAtBottom = true;
                this.updateJumpBar();
            } catch {
            }
        }

        private onWsMsg(m: any) {
            if (!m || typeof m !== "object") return;
            const currentMatchId = state.matchId;
            if (m.type === "CHAT_HISTORY") {
                if (m.matchId && currentMatchId && m.matchId !== currentMatchId) return;
                const items = Array.isArray(m.messages) ? m.messages : [];
                this.setHistory(items.map((x: any) => ({
                    userId: String(x.userId ?? "unknown"),
                    username: x.username ?? null,
                    text: String(x.text ?? ""),
                    ts: Number(x.ts ?? Date.now()),
                })));

                // history is "read" when open
                if (state.chat.isOpen && this.isAtBottom) {
                    state.chat.unreadCount = 0;
                    bus.emit("chat:unread", {unread: 0});
                    persistReadNow();
                }
                return;
            }

            if (m.type === "CHAT_MSG") {
                if (!m.matchId) return;
                if (currentMatchId && m.matchId !== currentMatchId) return;
                const item: ChatItem = {
                    userId: String(m.fromUserId ?? "unknown"),
                    username: m.username ?? null,
                    text: String(m.text ?? ""),
                    ts: Number(m.ts ?? Date.now()),
                };

                const isMine = item.userId === state.userId;

                if (!isMine) {
                    // Establish the first unread boundary once.
                    if (this.firstUnreadTs === null && this.restoredLastReadTs !== null && Number(item.ts) > this.restoredLastReadTs) {
                        this.firstUnreadTs = Number(item.ts);
                    }
                    // If user isn't following, ensure divider exists.
                    if (!this.isAtBottom) {
                        // Insert divider if not present
                        if (!this.hasNewDivider) {
                            this.insertNewMessagesDivider();
                        }
                        // Increase unread count
                        state.chat.unreadCount += 1;
                        bus.emit("chat:unread", {unread: state.chat.unreadCount});
                        persistUnread();
                    } else if (!state.chat.isOpen) {
                        state.chat.unreadCount += 1;
                        bus.emit("chat:unread", {unread: state.chat.unreadCount});
                        persistUnread();
                    }
                }

                const isUnread = !isMine && this.firstUnreadTs !== null && Number(item.ts) >= this.firstUnreadTs;

                if (isMine || this.isAtBottom) {
                    this.appendMsg(item, true);
                } else {
                    state.chat.messages.push(item);
                    this.renderMsg(item, false, isUnread);
                }
                this.updateJumpBar();
                return;
            }
        }

        private dividerId = "chat-new-divider";
        private hasNewDivider = false;

        private updateJumpBar() {
            const btn = this.querySelector("#jump-new") as HTMLButtonElement | null;
            if (!btn) return;
            const show = !this.isAtBottom && state.chat.unreadCount > 0;
            btn.classList.toggle("hidden", !show);
            if (show) btn.textContent = `New messages (${state.chat.unreadCount})`;
        }

        private insertNewMessagesDivider() {
            const list = this.$list();
            if (!list) return;

            if (list.querySelector(`#${this.dividerId}`)) {
                this.hasNewDivider = true;
                return;
            }

            const divider = document.createElement("div");
            divider.id = this.dividerId;
            divider.className = "text-[10px] text-center text-red-500 my-2";
            divider.textContent = "Unread messages";
            list.appendChild(divider);
            this.hasNewDivider = true;
        }

        private insertNewMessagesDividerBefore(el: HTMLElement) {
            const list = this.$list();
            if (!list) return;

            if (list.querySelector(`#${this.dividerId}`)) {
                this.hasNewDivider = true;
                return;
            }

            const divider = document.createElement("div");
            divider.id = this.dividerId;
            divider.className = "text-[10px] text-center text-red-500 my-2";
            divider.textContent = "Unread messages";
            list.insertBefore(divider, el);
            this.hasNewDivider = true;
        }

        private removeNewMessagesDivider() {
            const list = this.$list();
            if (!list) return;

            list.querySelector(`#${this.dividerId}`)?.remove();
            this.hasNewDivider = false;
        }

        private appendMsg(it: ChatItem, autoScroll = true) {
            state.chat.messages.push(it);
            this.renderMsg(it, autoScroll);
        }

        private scrollToBottom() {
            const list = this.$list();
            if (!list) return;
            list.scrollTop = list.scrollHeight;
        }

        private sendFromInput() {
            this.isAtBottom = true;
            state.chat.unreadCount = 0;
            bus.emit("chat:unread", {unread: 0});
            persistReadNow();
            if (!this.connected) return;

            const matchId = state.matchId;
            if (!matchId) {
                this.appendSystem("Not in a match.");
                return;
            }

            const input = this.$input();
            if (!input) return;

            const text = input.value.trim();
            if (!text) return;

            chatSend(matchId, text);
            input.value = "";
        }

        private appendSystem(text: string) {
            const msg: ChatItem = {
                userId: "system",
                username: "System",
                text,
                ts: Date.now(),
            };
            this.appendMsg(msg);
        }

        private render() {
            this.innerHTML = `
<div class="h-full w-full flex flex-col">

  <div id="list" class="flex-1 overflow-auto p-2 space-y-2 bg-gray-50"></div>

  <!-- NEW: jump bar -->
  <button id="jump-new"
          type="button"
          class="hidden mx-2 mb-2 rounded-xl border border-red-200 bg-red-50 text-red-700 text-[11px] px-3 py-2">
    New messages
  </button>

  <div class="border-t border-gray-100 bg-white p-2">
    <div class="flex items-center gap-2">
      <input id="msg"
             class="flex-1 border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
             placeholder="Type a message… (Enter to send)" />
      <button id="send" type="button" class="btn btn-primary text-xs px-3 py-2">Send</button>
    </div>
    <div class="text-[10px] text-gray-400 mt-1">Tip: Shift+Enter for newline.</div>
  </div>
</div>
`;
        }
    }
);
