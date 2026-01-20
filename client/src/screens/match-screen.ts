/**
 * match-screen.ts
 *
 * The main in-game match screen: composes shop, board, hand, chat and HUD,
 * handles user interactions (drag / drop / clicks) and forwards actions to
 * websocket helpers. Registered as `<match-screen>`.
 */

import "../ui/avatar-button";
import "../components/app-footer";
import "../components/chat-overlay";
import "../ui/card/tl-card";
import "../ui/card/card-template";
import "../components/match-header";
import "../components/match-vs-bar";
import "../components/match-shop";
import "../components/match-board";
import "../components/match-hand";
import "../components/match-sidebar";
import "../components/profile-panel";
import "../components/end-match-modal";

import type {MatchCard, MatchZones} from "../ui/types/card-types";
import {
    matchEndRound,
    matchForfeit,
    shopReroll,
    shopBuy,
    boardPlace,
    boardSell,
    towerUpgrade
} from "../core/ws";
import {state, type MatchState} from "../core/store";
import {buildStats} from "../ui/card/card-utils";
import {bus} from "../core/EventBus";
import {debug, error} from "../core/log";
import {fetchMatchCards} from "../core/cards";

customElements.define(
    "match-screen",
    class extends HTMLElement {
        private allCards: MatchCard[] = [];
        private zones: MatchZones = {
            deck: [],
            hand: [],
            discard: [],
            board: [],
        };

        private selectedHandIndex: number | null = null;

        private $(sel: string) {
            return this.querySelector(sel) as HTMLElement | null;
        }

        private offMatchState?: () => void;
        private offForfeitInfo?: () => void;
        private timerInterval: number | null = null;
        private contentRoot: HTMLDivElement | null = null;
        private suppressClickUntilTs = 0;
        private cardDetailOpen = false;
        private bindAbort?: AbortController;
        private offRequestEnd?: () => void;
        private offRequestForfeit?: () => void;
        private _endModalShownForMatch: string | boolean | undefined = undefined;

        private drag = {
            active: false,
            ctx: null as null | "hand" | "shop" | "board",
            cardId: null as string | null,
            handIndex: null as number | null,
            boardIndex: null as number | null,
            startX: 0,
            startY: 0,
            grabDx: 0,
            grabDy: 0,
            exceeded: false,
            ghost: null as HTMLElement | null,
            pointerId: 0,
        };


        private get match(): MatchState {
            return state.matchState;
        }

        connectedCallback() {
            debug("[match-screen] connectedCallback start");
            this.syncFromGlobalState();
            if (!this.contentRoot) {
                const root = document.createElement("div");
                root.className = "match-root";
                this.contentRoot = root;
                this.appendChild(root);
            }

            void this.loadAndRender();

            const handler = () => {
                this.syncFromGlobalState();
                this.rebuildZonesFromMatchState();
                this.render();
                this.bind();
                try {
                    const m = this.match;
                    const phase = m.phase;

                    const currentMatchId = String(m.matchId ?? state.matchId ?? "");
                    if (!currentMatchId) return;

                    // reset guard if match changed
                    if (typeof this._endModalShownForMatch === "string" && this._endModalShownForMatch !== currentMatchId) {
                        this._endModalShownForMatch = undefined;
                    }

                    const alreadyShownForThisMatch =
                        this._endModalShownForMatch === true || this._endModalShownForMatch === currentMatchId;

                    if (phase === "finished" && !alreadyShownForThisMatch) {
                        this._endModalShownForMatch = currentMatchId;
                        const waitMatchId = currentMatchId;
                        const shownOnce = {value: false};
                        const hasBattleOverlay = () => {
                            try {
                                return !!document.querySelector(`div[data-battle-overlay="true"][data-match-id="${CSS.escape(waitMatchId)}"]`);
                            } catch (e) {
                                return !!document.querySelector(`div[data-battle-overlay="true"][data-match-id="${waitMatchId}"]`);
                            }
                        };

                        const showModal = () => {
                            if (shownOnce.value) return;
                            try {
                                const currentHash = typeof location !== 'undefined' ? decodeURIComponent(location.hash || '') : '';
                                if (currentHash.startsWith(`#match/${waitMatchId}/result`)) {
                                    // mark as shown so we don't retry repeatedly
                                    shownOnce.value = true;
                                    return;
                                }
                            } catch (e) {
                            }

                            if (hasBattleOverlay()) return;
                            shownOnce.value = true;

                            try {
                                const mm = state.matchState as any;
                                const win = (mm?.towerHp ?? 0) > 0;
                                const modal = document.createElement("end-match-modal") as any;
                                if (win) modal.setAttribute("win", "true");
                                try {
                                    const selfReason = mm?.eliminationReason ?? undefined;
                                    let opponentReason: string | undefined = undefined;
                                    try {
                                        const others = Array.isArray(mm?.playersSummary) ? mm.playersSummary.filter((p: any) => String(p.userId) !== String(state.userId ?? '')) : [];
                                        if (others.length) opponentReason = others[0]?.eliminationReason ?? undefined;
                                    } catch (e) {
                                    }
                                    if (selfReason) modal.setAttribute('elimination-reason', String(selfReason));
                                    if (opponentReason) modal.setAttribute('opponent-elimination-reason', String(opponentReason));
                                } catch (e) {
                                }

                                modal.addEventListener("modal:confirm", () => {
                                    const id = String(mm?.matchId ?? state.matchId ?? "");
                                    if (id) location.hash = `#match/${encodeURIComponent(id)}/result`;
                                    else
                                        try {
                                            // update browser URL to root without reloading
                                            if (window.history && typeof window.history.pushState === 'function') {
                                                window.history.pushState({}, '', '/');
                                                // notify app to render Home (main.ts listens for nav:home)
                                                try {
                                                    document.dispatchEvent(new CustomEvent('nav:home'));
                                                } catch (e) {
                                                }
                                                return;
                                            }
                                        } catch (e) {
                                        }
                                });
                                document.body.appendChild(modal);
                            } catch (e) {
                            }
                        };

                        const battleFinishedHandler = (p: any) => {
                            try {
                                if (!p) return;
                                if (String(p.matchId ?? "") !== waitMatchId) return;
                                // show only after overlay is removed
                                showModal();
                            } catch (e) {
                            }
                            try {
                                bus.off("match:battle-finished", battleFinishedHandler);
                            } catch (e) {
                            }
                            try {
                                clearTimeout(fallback);
                            } catch (e) {
                            }
                        };

                        bus.on("match:battle-finished", battleFinishedHandler);


                        const fallback = window.setTimeout(() => {
                            try {
                                bus.off("match:battle-finished", battleFinishedHandler);
                            } catch (e) {
                            }
                            showModal();
                        }, 12000);

                        if (!hasBattleOverlay()) {
                            setTimeout(showModal, 50);
                        }
                    }
                } catch (e) {
                }
            };
            bus.on("match:state", handler);
            this.offMatchState = () => bus.off("match:state", handler);
            const ffHandler = (p: any) => {
                const {matchId, userId} = p || {};
                if (!matchId || state.matchId !== matchId) return;
                if (userId && userId === state.userId) return;
                this.render();
                this.bind();
            };
            bus.on("match:forfeit-info", ffHandler);
            this.offForfeitInfo = () => bus.off("match:forfeit-info", ffHandler);

            const denyShopHandler = (p: any) => {
                if (!p || p.matchId !== state.matchId) return;
                if (String(p.userId ?? '') !== String(state.userId ?? '')) return;
                const reason = p.reason ?? 'ACTION_DENIED';
                if (reason === 'HAND_FULL') {
                    try {
                        const mh = document.querySelector('match-hand') as any | null;
                        if (mh && typeof mh.showHandFull === 'function') {
                            mh.showHandFull(2500);
                            return;
                        }
                        const existing = document.querySelector('.hand-full-badge-global') as HTMLElement | null;
                        if (existing) {
                            try {
                                existing.style.left = '50%';
                                existing.style.bottom = '84px';
                                existing.style.removeProperty('top');

                                const t = (existing as any)._handFullTimeout;
                                if (t) clearTimeout(t);
                                const iv = (existing as any)._handFullReposition;
                                if (iv) {
                                    try {
                                        clearInterval(iv);
                                    } catch {
                                    }
                                }
                            } catch (e) {
                            }
                            (existing as any)._handFullReposition = null;
                            (existing as any)._handFullTimeout = setTimeout(() => {
                                try {
                                    const iv = (existing as any)._handFullReposition;
                                    if (iv) clearInterval(iv);
                                    existing.remove();
                                } catch (e) {
                                }
                            }, 1400);
                            return;
                        }
                        const badge = document.createElement('div');
                        badge.className = 'hand-full-badge-global hand-full-badge px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs border border-yellow-200';
                        badge.textContent = 'Hand full';
                        badge.style.position = 'fixed';
                        badge.style.zIndex = '9999';
                        badge.style.pointerEvents = 'none';
                        badge.style.boxShadow = '0 2px 6px rgba(0,0,0,0.12)';
                        badge.style.transform = 'translateX(-50%)';
                        badge.style.left = '50%';
                        badge.style.bottom = '84px';
                        badge.style.removeProperty('top');
                        document.body.appendChild(badge);
                        (badge as any)._handFullReposition = null;
                        (badge as any)._handFullTimeout = setTimeout(() => {
                            try {
                                const iv = (badge as any)._handFullReposition;
                                if (iv) clearInterval(iv);
                                badge.remove();
                            } catch (e) {
                            }
                        }, 1400);
                    } catch (e) {
                    }
                }
                this.showTempNotification(`Buy denied: ${reason}`);
            };
            bus.on('match:shop-buy-denied', denyShopHandler);

            const denyPlaceHandler = (p: any) => {
                if (!p || p.matchId !== state.matchId) return;
                const reason = p.reason ?? 'ACTION_DENIED';
                this.showTempNotification(`Play denied: ${reason}`);
            };
            bus.on('match:board-place-denied', denyPlaceHandler);

            const offDenyShop = () => bus.off('match:shop-buy-denied', denyShopHandler);
            const offDenyPlace = () => bus.off('match:board-place-denied', denyPlaceHandler);
            const prevOff = this.offForfeitInfo;
            this.offForfeitInfo = () => {
                prevOff?.();
                offDenyShop();
                offDenyPlace();
            };

            if (this.timerInterval == null) {
                this.timerInterval = window.setInterval(() => {
                    const m = this.match;
                    if (typeof m.roundTimerTs === "number" && m.roundTimerTs > 0) {
                        const timerEl = this.querySelector("[data-role='round-timer']");
                        if (timerEl) {
                            const now = Date.now();
                            const diffMs = Math.max(0, m.roundTimerTs - now);
                            const secs = Math.ceil(diffMs / 1000);
                            (timerEl as HTMLElement).textContent = `${secs}s`;
                        }
                    }
                }, 1_000);
            }

            const mergeHandler = (p: any) => {
                if (!p || p.matchId !== state.matchId) return;
                const chosenIdx = typeof p.chosenIndex === 'number' ? p.chosenIndex : null;
                const cleared = Array.isArray(p.clearedIndices) ? p.clearedIndices : [];
                if (chosenIdx != null) {
                    const chosenBtn = this.querySelector(`button[data-zone='board'][data-index='${chosenIdx}']`) as HTMLElement | null;
                    if (chosenBtn) {
                        chosenBtn.classList.add('board-merge-chosen');
                        const badge = chosenBtn.querySelector('.ml-1') as HTMLElement | null;
                        if (badge) badge.classList.add('merge-badge-pulse');
                        setTimeout(() => {
                            chosenBtn.classList.remove('board-merge-chosen');
                            if (badge) badge.classList.remove('merge-badge-pulse');
                        }, 900);
                    }
                }
                for (const idx of cleared) {
                    const b = this.querySelector(`button[data-zone='board'][data-index='${idx}']`) as HTMLElement | null;
                    if (b) {
                        b.classList.add('board-merge-cleared');
                        setTimeout(() => {
                            b.classList.remove('board-merge-cleared');
                        }, 700);
                    }
                }
            };
            bus.on('match:board-merge', mergeHandler);

            const prevOff2 = this.offForfeitInfo;
            this.offForfeitInfo = () => {
                prevOff2?.();
                bus.off('match:board-merge', mergeHandler);
            };
        }

        disconnectedCallback() {
            this.offMatchState?.();
            this.offMatchState = undefined;
            this.offForfeitInfo?.();
            this.offForfeitInfo = undefined;

            try {
                this.offRequestEnd?.();
                this.offRequestForfeit?.();
            } catch (e) {
            }

            if (this.timerInterval != null) {
                clearInterval(this.timerInterval);
                this.timerInterval = null;
            }

            try {
                document.querySelectorAll('.mobile-shop-overlay').forEach((n) => (n as HTMLElement).remove());
            } catch (e) {
            }

            if (this.contentRoot) {
                this.contentRoot.remove();
                this.contentRoot = null;
            }
        }

        private syncFromGlobalState() {
        }

        private rebuildZonesFromMatchState() {
            if (!this.allCards.length) return;

            const m: MatchState = this.match;
            const byId = (id: string) => this.getCardById(id);

            const deckIds: string[] = Array.isArray(m.deckIds) ? m.deckIds : [];
            const handIds: string[] = Array.isArray(m.handIds) ? m.handIds : [];
            const discardIds: string[] = Array.isArray(m.discardIds) ? m.discardIds : [];
            const boardSlots = Array.isArray(m.boardSlots) ? m.boardSlots : [];

            this.zones.deck = deckIds.map(byId).filter((c): c is MatchCard => !!c);
            this.zones.hand = handIds.map(byId).filter((c): c is MatchCard => !!c);
            this.zones.discard = discardIds.map(byId).filter((c): c is MatchCard => !!c);

            this.zones.board = boardSlots.map((slot) => ({
                card: slot.cardId ? byId(slot.cardId) : null,
                stackCount: slot.stackCount,
            }));
        }

        private async loadAndRender() {
            if (!this.allCards.length) {
                await this.loadCards();
            }
            this.rebuildZonesFromMatchState();
            this.render();
            this.bind();
        }

        private async loadCards() {
            try {
                const API = (window as any).__CFG__.API_URL;
                this.allCards = await fetchMatchCards(API);
                (window as any).getCardById = this.getCardById.bind(this);
            } catch (e) {
                error("[match-screen] Failed to load cards", e);
                this.allCards = [];
            }
        }

        private getCardById(id: string): MatchCard | null {
            return this.allCards.find((c) => c.id === id) ?? null;
        }

        private render() {
            const m: MatchState = this.match;
            m.towerHpMax > 0
                ? Math.max(0, Math.min(100, (m.towerHp / m.towerHpMax) * 100))
                : 0;

            if (!this.contentRoot) {
                const root = document.createElement("div");
                root.className = "match-root";
                this.contentRoot = root;
                this.appendChild(root);
            }

            this.contentRoot!.innerHTML = `
    <div class="game-screen">
      <match-header></match-header>
      <match-vs-bar></match-vs-bar>
      <!-- floating profile button top-right -->
      <button id="btn-profile" class="fixed top-4 right-4 z-60 w-10 h-10 rounded-full bg-white shadow flex items-center justify-center">P</button>
      <!-- mobile shop toggle (visible via CSS on small landscape) -->
      <button id="btn-mobile-shop" aria-label="Open shop" class="fixed left-4 bottom-4 z-80 w-10 h-10 rounded-full bg-white shadow flex items-center justify-center overflow-visible">
        <span id="btn-mobile-shop-badge" class="absolute -top-2 -right-2 w-5 h-5 rounded-full text-[10px] flex items-center justify-center bg-red-600 text-white" style="z-index:999; pointer-events:none">0</span>
        Shop
      </button>
      <main class="w-full px-4 pb-3 pt-2">
        <div class="w-full max-w-5xl mx-auto flex flex-col gap-3" style="min-height:0;">
          <div class="flex-1 overflow-auto" style="min-height:0;">
            <match-shop></match-shop>
            <match-board></match-board>
            <match-hand></match-hand>
          </div>
        </div>
      </main>
      <chat-overlay></chat-overlay>
      <app-footer></app-footer>
    </div>
   `;

            try {
                const badge = this.contentRoot!.querySelector('#btn-mobile-shop-badge') as HTMLElement | null;
                const mobileBtn = this.contentRoot!.querySelector('#btn-mobile-shop') as HTMLElement | null;
                const shopCount = Array.isArray(m.shopIds) ? m.shopIds.length : 0;
                if (badge) {
                    badge.textContent = String(shopCount);
                    if (shopCount === 0) {
                        badge.classList.remove('bg-red-600', 'text-white');
                        badge.classList.add('bg-gray-300', 'text-gray-700');
                        mobileBtn?.setAttribute('disabled', 'true');
                        mobileBtn?.setAttribute('aria-disabled', 'true');
                        mobileBtn?.classList.add('opacity-50', 'cursor-not-allowed');
                    } else {
                        badge.classList.remove('bg-gray-300', 'text-gray-700');
                        badge.classList.add('bg-red-600', 'text-white');
                        mobileBtn?.removeAttribute('disabled');
                        mobileBtn?.removeAttribute('aria-disabled');
                        mobileBtn?.classList.remove('opacity-50', 'cursor-not-allowed');
                    }
                }
            } catch (e) {
            }
            const header = this.contentRoot.querySelector("match-header");
            if (header) (header as any).match = m;
            const vsBar = this.contentRoot.querySelector("match-vs-bar");
            if (vsBar) (vsBar as any).match = m;
            const shop = this.contentRoot.querySelector("match-shop");
            if (shop) (shop as any).match = m;
            const board = this.contentRoot.querySelector("match-board");
            if (board) (board as any).match = m;
            const hand = this.contentRoot.querySelector("match-hand");
            if (hand) (hand as any).match = m;
            const sidebar = this.contentRoot.querySelector("match-sidebar");
            if (sidebar) (sidebar as any).match = m;
        }

        private bind() {
            this.bindAbort?.abort();
            const ac = new AbortController();
            this.bindAbort = ac;
            const {signal} = ac;
            const DRAG_THRESHOLD_PX = 10;
            const actions = {
                endRound: () => this.requestEndRound(),
                forfeit: () => this.requestForfeit(),
                upgradeTower: () => {
                    try {
                        if (this.pendingUpgrade) return;
                        this.pendingUpgrade = true;
                        if (state.matchId) towerUpgrade(state.matchId);
                        setTimeout(() => {
                            this.pendingUpgrade = false;
                        }, 800);
                    } catch (e) {
                        this.pendingUpgrade = false;
                    }
                },
                rerollShop: () => {
                    try {
                        if (this.pendingReroll) return;
                        this.pendingReroll = true;
                        if (state.matchId) shopReroll(state.matchId);
                        setTimeout(() => {
                            this.pendingReroll = false;
                        }, 800);
                    } catch (e) {
                        this.pendingReroll = false;
                    }
                },
                buyFromShop: (cardId: string, cost?: number) => {
                    if (!state.matchId) return;
                    const gold = state.matchState.gold ?? 0;
                    if (typeof cost === 'number' && gold < cost) {
                        this.showTempNotification('Not enough gold to buy this card');
                        return;
                    }
                    shopBuy(state.matchId, cardId);
                },
                placeOnBoard: (handIndex: number, boardIndex: number) => {
                    if (!state.matchId) return;
                    const card = this.zones.hand[handIndex];
                    const cost = (card as any)?.cost ?? 0;
                    const gold = state.matchState.gold ?? 0;
                    if (gold < cost) {
                        this.showTempNotification('Not enough gold to play this card');
                        return;
                    }
                    const slot = this.zones.board[boardIndex];
                    if (card.type !== 'buff' && card.type !== 'economy') {
                        if (slot.card) {
                            if (slot.card.id !== card.id) {
                                this.showTempNotification('Cannot place onto occupied slot');
                                return;
                            }
                            if ((slot.stackCount ?? 0) >= 3) {
                                this.showTempNotification('Slot already at max stack');
                                return;
                            }
                        }
                    }
                    boardPlace(state.matchId, handIndex, boardIndex);
                },
                sellFromBoard: (boardIndex: number) => state.matchId && boardSell(state.matchId, boardIndex),
            } as const;
            try {
                this.offRequestEnd?.();
                this.offRequestForfeit?.();
            } catch (e) {
            }
            const endReq = (p: any) => {
                if (!p || String(p.matchId) !== String(state.matchId)) return;
                this.requestEndRound();
            };
            const forfeitReq = (p: any) => {
                if (!p || String(p.matchId) !== String(state.matchId)) return;
                this.requestForfeit();
            };
            bus.on('match:request-end-round', endReq);
            bus.on('match:request-forfeit', forfeitReq);
            this.offRequestEnd = () => bus.off('match:request-end-round', endReq);
            this.offRequestForfeit = () => bus.off('match:request-forfeit', forfeitReq);

            this.addEventListener("audio-panel", (e: any) => {
                const open = !!e.detail?.open;
                const chatOverlay = this.contentRoot?.querySelector("chat-overlay") as any;
                chatOverlay?.setAudioOverlayOpen?.(open);
            });

            const applySmallLayout = () => {
                try {
                    const small = window.innerHeight <= 420 && window.innerWidth >= window.innerHeight;
                    const shopSection = this.contentRoot?.querySelector('[data-role="shop-section"]') as HTMLElement | null;
                    const handSection = this.contentRoot?.querySelector('[data-role="hand-section"]') as HTMLElement | null;
                    const vsCenter = this.contentRoot?.querySelector('.vs-center-extra') as HTMLElement | null;
                    if (small) {

                        shopSection?.classList.remove('expanded');
                        handSection?.classList.remove('expanded');
                        if (vsCenter) vsCenter.classList.remove('hidden');
                    } else {
                        if (vsCenter) vsCenter.classList.add('hidden');
                    }
                } catch (e) {
                }
            };
            applySmallLayout();
            window.addEventListener('resize', applySmallLayout, {signal});
            window.addEventListener('orientationchange', applySmallLayout, {signal});

            const docClickHandler = (ev: Event) => {
                const mev = ev as MouseEvent;
                const target = ev.target as HTMLElement | null;
                if (!target) return;
                const anyEv = ev as Event & { __matchScreenCardDetailHandled?: boolean };
                if (anyEv.__matchScreenCardDetailHandled) return;
                try {
                    const modalHost = document.querySelector('match-shop[data-modal-open="true"]') as HTMLElement | null;
                    const modalOverlay = document.querySelector('.shop-modal') as HTMLElement | null;
                    if (modalOverlay && modalOverlay.contains(target)) {
                        return;
                    }
                    if (modalHost && modalHost.contains(target)) {
                        return;
                    }
                } catch (e) {
                }

                if (Date.now() < this.suppressClickUntilTs) {
                    mev.preventDefault();
                    mev.stopPropagation();
                    return;
                }

                if (this.drag.exceeded) {
                    this.drag.exceeded = false;
                    mev.preventDefault();
                    mev.stopPropagation();
                    return;
                }

                const rerollBtn = target.closest('#btn-reroll') as HTMLElement | null;
                if (rerollBtn) {
                    try {
                        actions.rerollShop();
                    } catch (e) {
                    }
                    return;
                }

                const upgradeBtn = target.closest('#btn-tower-upgrade') as HTMLElement | null;
                if (upgradeBtn) {
                    try {
                        actions.upgradeTower();
                    } catch (e) {
                    }
                    return;
                }

                const toggleShopBtn =
                    (target.closest('[data-action="toggle-shop"]') as HTMLElement | null) ||
                    ((target as any).closest?.('[data-action="toggle-shop"]') as HTMLElement | null);

                if (toggleShopBtn) {
                    try {
                        const shopSection = this.contentRoot?.querySelector('[data-role="shop-section"]') as HTMLElement | null;
                        if (shopSection) {
                            const isExpanded = shopSection.classList.toggle('expanded');
                            if (isExpanded) {
                                const handSection = this.contentRoot?.querySelector('[data-role="hand-section"]') as HTMLElement | null;
                                handSection?.classList.remove('expanded');
                            }
                        }
                    } catch (e) {
                    }
                    return;
                }

                const toggleHandBtn =
                    (target.closest('[data-action="toggle-hand"]') as HTMLElement | null) ||
                    ((target as any).closest?.('[data-action="toggle-hand"]') as HTMLElement | null);

                if (toggleHandBtn) {
                    try {
                        const handSection = this.contentRoot?.querySelector('[data-role="hand-section"]') as HTMLElement | null;
                        if (handSection) {
                            const isExpanded = handSection.classList.toggle('expanded');
                            if (isExpanded) {
                                const shopSection = this.contentRoot?.querySelector('[data-role="shop-section"]') as HTMLElement | null;
                                shopSection?.classList.remove('expanded');
                            }
                        }
                    } catch (e) {
                    }
                    return;
                }

                const boardBtn = target.closest("button[data-zone='board']") as HTMLElement | null;
                if (boardBtn) {
                    const index = Number(boardBtn.dataset.index ?? "-1");
                    if (index < 0) return;

                    const slot = this.zones.board[index];
                    if (!slot.card) {
                        if (this.selectedHandIndex != null) actions.placeOnBoard(this.selectedHandIndex, index);
                    } else {
                        anyEv.__matchScreenCardDetailHandled = true;
                        this.openCardDetail(slot.card, {
                            primaryLabel: "Sell",
                            onPrimary: () => actions.sellFromBoard(index),
                            secondaryLabel: "Cancel",
                        });
                    }
                    return;
                }

                const tile = target.closest(".match-card-tile") as HTMLElement | null;
                if (!tile) return;

                const cardId = tile.dataset.cardId;
                if (!cardId) return;

                const ctx = (tile.dataset.context as "shop" | "hand" | undefined) ?? null;
                if (!ctx) return;

                const card = this.getCardById(cardId);
                if (!card) return;

                if (ctx === "shop") {
                    anyEv.__matchScreenCardDetailHandled = true;
                    this.openCardDetail(card, {
                        primaryLabel: "Buy",
                        primaryDisabled: (this.match.gold ?? 0) < (card.cost ?? 0),
                        onPrimary: () => actions.buyFromShop(card.id, card.cost),
                        secondaryLabel: "Cancel",
                    });
                    try {
                        tile.blur?.();
                        (document.activeElement as HTMLElement | null)?.blur?.();
                    } catch (e) {
                    }
                    return;
                }

                anyEv.__matchScreenCardDetailHandled = true;
                this.openCardDetail(card, {
                    primaryLabel: "Play",
                    primaryDisabled: (this.match.gold ?? 0) < (card.cost ?? 0),
                    onPrimary: () => this.playHandCardToFirstEmptySlot(card.id, actions),
                    secondaryLabel: "Cancel",
                });
                try {
                    tile.blur?.();
                    (document.activeElement as HTMLElement | null)?.blur?.();
                } catch (e) {
                }
            };
            document.addEventListener('click', docClickHandler, {signal});
            const mobileShopBtn = this.$('#btn-mobile-shop') as HTMLElement | null;
            try {
                const badge = this.$('#btn-mobile-shop-badge') as HTMLElement | null;
                const shopCount = Array.isArray(this.match?.shopIds) ? this.match.shopIds.length : 0;
                if (badge) {
                    badge.textContent = String(shopCount);
                    if (shopCount === 0) {
                        badge.classList.remove('bg-red-600', 'text-white');
                        badge.classList.add('bg-gray-300', 'text-gray-700');
                        mobileShopBtn?.setAttribute('disabled', 'true');
                        mobileShopBtn?.setAttribute('aria-disabled', 'true');
                        (mobileShopBtn as HTMLElement | null)?.classList.add('opacity-50', 'cursor-not-allowed');
                    } else {
                        badge.classList.remove('bg-gray-300', 'text-gray-700');
                        badge.classList.add('bg-red-600', 'text-white');
                        mobileShopBtn?.removeAttribute('disabled');
                        mobileShopBtn?.removeAttribute('aria-disabled');
                        (mobileShopBtn as HTMLElement | null)?.classList.remove('opacity-50', 'cursor-not-allowed');
                    }
                }
            } catch (e) {
            }
            const openMobileShop = () => {
                try {
                    const liveShop = this.contentRoot?.querySelector('match-shop') as any | null;
                    if (liveShop && typeof liveShop.open === 'function') {
                        liveShop.open();
                        return;
                    }
                    const shopEl = document.createElement('match-shop') as any;
                    try {
                        shopEl.match = this.match;
                    } catch (e) {
                    }
                    const shopSection = this.contentRoot?.querySelector('[data-role="shop-section"]') as HTMLElement | null;
                    if (shopSection) shopSection.appendChild(shopEl); else (this.contentRoot as HTMLElement | null)?.appendChild(shopEl);
                    if (typeof shopEl.open === 'function') shopEl.open();
                } catch (e) {
                }
            };
            mobileShopBtn?.addEventListener('click', openMobileShop, {signal});

            document.addEventListener(
                "pointerdown",
                (ev: PointerEvent) => {
                    if (ev.button !== 0 && ev.pointerType === "mouse") return;
                    const target = ev.target as HTMLElement | null;
                    if (!target) return;
                    const tile = target.closest(".match-card-tile") as HTMLElement | null;
                    if (tile && tile.dataset.cardId) {
                        const cardId = tile.dataset.cardId;
                        const ctx = (tile.dataset.context as "shop" | "hand" | "board" | undefined) ?? null;
                        if (ctx === 'shop') {
                            try {
                                const liveShop = this.contentRoot?.querySelector('match-shop') as any | null;
                                if (liveShop && liveShop.getAttribute('data-modal-open') === 'true') {
                                    return;
                                }
                            } catch (e) {
                            }
                        }

                        if (ctx !== "hand" && ctx !== "shop") return;
                        const card = this.getCardById(cardId);
                        if (!card) return;
                        this.resetDrag();
                        this.drag.active = true;
                        this.drag.ctx = ctx;
                        this.drag.cardId = cardId;
                        if (ctx === 'hand') {
                            const hi = tile.getAttribute('data-hand-index');
                            this.drag.handIndex = hi != null ? Number(hi) : null;
                        } else {
                            this.drag.handIndex = null;
                        }
                        this.drag.pointerId = ev.pointerId;
                        this.drag.startX = ev.clientX;
                        this.drag.startY = ev.clientY;

                        const rect = tile.getBoundingClientRect();
                        this.drag.grabDx = ev.clientX - rect.left;
                        this.drag.grabDy = ev.clientY - rect.top;

                        this.drag.ghost = this.createCardGhost(card, ctx === "hand" ? "hand-card-wrapper" : "shop-card-wrapper");
                        this.drag.ghost.style.left = `${ev.clientX - this.drag.grabDx}px`;
                        this.drag.ghost.style.top = `${ev.clientY - this.drag.grabDy}px`;

                        ev.preventDefault();
                        (tile as any).setPointerCapture?.(ev.pointerId);

                        if (ctx === "hand") this.highlightBoardForCard(card);
                        if (ctx === "shop") {
                            const handComponent = this.contentRoot?.querySelector("match-hand") as any;
                            if (handComponent?.showDropHighlight) {
                                handComponent.showDropHighlight(`Drop to buy for ${card.cost}g`);
                            }
                        }
                        return;
                    }

                    const boardBtn = target.closest("button[data-zone='board']") as HTMLElement | null;
                    if (boardBtn) {
                        const index = Number(boardBtn.dataset.index ?? "-1");
                        if (index < 0) return;

                        const slot = this.zones.board[index];
                        if (!slot?.card) return;

                        const card = slot.card;

                        this.resetDrag();
                        this.drag.active = true;
                        this.drag.ctx = "board";
                        this.drag.boardIndex = index;
                        this.drag.cardId = card.id;
                        this.drag.pointerId = ev.pointerId;
                        this.drag.startX = ev.clientX;
                        this.drag.startY = ev.clientY;

                        const rect = boardBtn.getBoundingClientRect();
                        this.drag.grabDx = ev.clientX - rect.left;
                        this.drag.grabDy = ev.clientY - rect.top;

                        this.drag.ghost = this.createCardGhost(card, "hand-card-wrapper");
                        this.drag.ghost.style.left = `${ev.clientX - this.drag.grabDx}px`;
                        this.drag.ghost.style.top = `${ev.clientY - this.drag.grabDy}px`;

                        ev.preventDefault();
                        (boardBtn as any).setPointerCapture?.(ev.pointerId);

                        const shopGrid = this.querySelector("[data-role='shop-grid']") as HTMLElement | null;
                        if (shopGrid) {
                            shopGrid.classList.add("shop-drop-highlight");
                            const cardCost = Number(slot.card?.cost ?? 0) || 0;
                            const gain = Math.max(0, Math.floor(cardCost / 2));
                            const hint = `Drop to sell for ${gain}g`;
                            shopGrid.setAttribute("data-drop-hint", hint);
                            shopGrid.title = hint;
                        }
                        try {
                            const mobileBtn = this.contentRoot?.querySelector('#btn-mobile-shop') as HTMLElement | null;
                            if (mobileBtn) {
                                mobileBtn.classList.add('shop-drop-highlight');
                                const cardCost = Number(slot.card?.cost ?? 0) || 0;
                                const gain = Math.max(0, Math.floor(cardCost / 2));
                                const hintMobile = `Drop to sell for ${gain}g`;
                                mobileBtn.setAttribute('data-drop-hint', hintMobile);
                                mobileBtn.title = hintMobile;
                            }
                        } catch (e) {
                        }
                        return;
                    }
                },
                {signal, passive: false}
            );

            document.addEventListener(
                "pointermove",
                (ev: PointerEvent) => {
                    if (!this.drag.active) return;
                    if (ev.pointerId !== this.drag.pointerId) return;
                    if (!this.drag.exceeded) {
                        const dist2 = this.squaredDist(this.drag.startX, this.drag.startY, ev.clientX, ev.clientY);
                        if (dist2 < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
                        this.drag.exceeded = true;
                        const under = ev.target as HTMLElement | null;
                        const tile = under?.closest(".match-card-tile") as HTMLElement | null;
                        const boardBtn = under?.closest("button[data-zone='board']") as HTMLElement | null;
                        (tile ?? boardBtn)?.classList.add("dragging");
                    }

                    if (this.drag.ghost) {
                        this.drag.ghost.style.left = `${ev.clientX - this.drag.grabDx}px`;
                        this.drag.ghost.style.top = `${ev.clientY - this.drag.grabDy}px`;
                    }
                    if (this.drag.ctx === "hand") {
                        this.highlightBoardForCard(this.getCardById(this.drag.cardId!));
                    }
                },
                {signal}
            );

            document.addEventListener(
                "pointerup",
                (ev: PointerEvent) => {
                    if (!this.drag.active) return;
                    if (ev.pointerId !== this.drag.pointerId) return;

                    const ctx = this.drag.ctx;
                    const cardId = this.drag.cardId;
                    const boardIndex = this.drag.boardIndex;
                    const exceeded = this.drag.exceeded;
                    const shopGrid = this.querySelector("[data-role='shop-grid']") as HTMLElement | null;
                    if (shopGrid) {
                        shopGrid.classList.remove("shop-drop-highlight");
                        shopGrid.removeAttribute("data-drop-hint");
                        shopGrid.removeAttribute("title");
                    }
                    const handComponent = this.contentRoot?.querySelector("match-hand") as any;
                    handComponent?.clearDropHighlight?.();
                    try {
                        const mobileBtn = this.contentRoot?.querySelector('#btn-mobile-shop') as HTMLElement | null;
                        if (mobileBtn) {
                            mobileBtn.classList.remove('shop-drop-highlight');
                            mobileBtn.removeAttribute('data-drop-hint');
                            mobileBtn.removeAttribute('title');
                        }
                    } catch (e) {
                    }
                    this.querySelectorAll(".dragging").forEach((n) => (n as HTMLElement).classList.remove("dragging"));
                    if (exceeded) {
                        this.suppressClickUntilTs = Date.now() + 400;
                    }

                    this.resetDrag();
                    if (!exceeded) return;
                    if (!cardId) return;
                    if (ctx === "hand") {
                        const dropBoardIndex = this.findBoardIndexAt(ev.clientX, ev.clientY);
                        if (dropBoardIndex == null) return;

                        const handIndex = this.drag.handIndex != null ? this.drag.handIndex : this.zones.hand.findIndex((c) => c.id === cardId);
                        if (handIndex === -1) return;

                        actions.placeOnBoard(handIndex, dropBoardIndex);
                        return;
                    }

                    if (ctx === "shop") {
                        if (this.isInsideHandArea(ev.clientX, ev.clientY)) {
                            actions.buyFromShop(cardId);
                        }
                        return;
                    }

                    if (ctx === "board" && boardIndex != null) {
                        if (this.isInsideShopGrid(ev.clientX, ev.clientY) || this.isInsideMobileShop(ev.clientX, ev.clientY)) {
                            actions.sellFromBoard(boardIndex);
                        }
                    }
                },
                {signal}
            );

            this.$("#btn-profile")?.addEventListener("click", () => {
                try {
                    let pp = document.querySelector('profile-panel') as any | null;
                    if (!pp) {
                        pp = document.createElement('profile-panel') as any;
                        document.body.appendChild(pp);
                    }
                    if (typeof pp.open === 'function') pp.open({includeMatchSidebar: true});
                } catch (e) {
                }
            }, {signal});

            const shopBuyHandler = (ev: Event) => {
                try {
                    const ce = ev as CustomEvent<{ cardId: string; cost?: number }>;
                    const cardId = ce.detail?.cardId;
                    const cost = ce.detail?.cost;
                    if (cardId) {
                        actions.buyFromShop(cardId, cost);
                    }
                } catch (e) {
                }
            };
            document.addEventListener('shop:buy', shopBuyHandler, {signal});

            const docRerollHandler = (ev: Event) => {
                try {
                    actions.rerollShop();
                } catch (e) {
                }
            };
            document.addEventListener('shop:reroll', docRerollHandler, {signal});
        }

        private highlightBoardForCard(card: MatchCard | null) {
            const boardGrid = this.querySelector("[data-role='board-grid']") as HTMLElement | null;
            const buttons = this.querySelectorAll("button[data-zone='board']");

            buttons.forEach((node) => {
                (node as HTMLElement).classList.remove("board-slot-highlight");
            });
            boardGrid?.classList.remove("board-highlight-all");

            if (!card) return;

            if (card.type === "buff" || card.type === "economy") {
                boardGrid?.classList.add("board-highlight-all");
                return;
            }

            buttons.forEach((node) => {
                const el = node as HTMLElement;
                const idx = Number(el.dataset.index ?? "-1");
                if (idx < 0) return;
                const slot = this.zones.board[idx];
                const canPlaceHere = !slot.card;
                el.classList.toggle("board-slot-highlight", canPlaceHere);
            });
        }

        private clearBoardHighlights() {
            const boardGrid = this.querySelector("[data-role='board-grid']") as HTMLElement | null;
            const buttons = this.querySelectorAll("button[data-zone='board']");
            buttons.forEach((node) => {
                (node as HTMLElement).classList.remove("board-slot-highlight");
            });
            boardGrid?.classList.remove("board-highlight-all");
        }

        private playHandCardToFirstEmptySlot(cardId: string, actions: {
            placeOnBoard: (handIndex: number, boardIndex: number) => void;
        }) {
            let handIndex = this.selectedHandIndex != null ? this.selectedHandIndex : this.zones.hand.findIndex((c) => c.id === cardId);
            if (handIndex === -1) return;
            const emptyIndex = this.zones.board.findIndex((s) => !s.card);
            if (emptyIndex === -1) return;
            actions.placeOnBoard(handIndex, emptyIndex);
        }

        private openCardDetail(
            card: MatchCard,
            opts: {
                title?: string;
                primaryLabel: string;
                onPrimary: () => void;
                primaryDisabled?: boolean;
                secondaryLabel?: string;
                onSecondary?: () => void;
            }
        ) {
            debug('[match-screen] openCardDetail', {
                cardId: card.id,
                cardName: card.name,
                opts: {
                    primaryLabel: opts.primaryLabel,
                    secondaryLabel: opts.secondaryLabel,
                    primaryDisabled: opts.primaryDisabled ?? false,
                }
            });

            if (this.cardDetailOpen) return;
            if (document.querySelector('.card-detail-overlay')) return;
            this.cardDetailOpen = true;

            const overlay = document.createElement("div");
            overlay.className =
                "card-detail-overlay fixed inset-0 z-50 flex items-center justify-center bg-transparent overlay-blur";

            const onKeyDown = (ev: KeyboardEvent) => {
                if (ev.key === "Escape") {
                    try {
                        ev.preventDefault();
                    } catch (e) {
                    }
                    close();
                }
            };

            const close = () => {
                try {
                    document.removeEventListener("keydown", onKeyDown, {capture: true} as any);
                } catch (e) {
                }
                try {
                    overlay.remove();
                } catch (e) {
                }
                this.cardDetailOpen = false;
            };

            document.addEventListener("keydown", onKeyDown, {capture: true});

            const inner = document.createElement("div");
            inner.className =
                "card-detail-inner relative bg-white rounded-2xl shadow-2xl border border-gray-200 max-w-sm";

            const main = document.createElement("tl-card") as any;
            main.setAttribute("name", card.name || "");
            main.setAttribute("cost", String(card.cost ?? 0));
            if ((card as any).type) main.setAttribute("type", (card as any).type);
            if ((card as any).rarity) main.setAttribute("rarity", (card as any).rarity);
            if ((card as any).image) main.setAttribute("image", (card as any).image);
            if ((card as any).description) main.setAttribute("description", (card as any).description);

            try {
                main.setAttribute("stats", (card as any).stats ?? buildStats(card as any));
            } catch (e) {
            }
            main.classList.add("detail-card", "mb-6");
            main.style.pointerEvents = "none";
            inner.appendChild(main);

            const overlayCloseBtn = document.createElement("button");
            overlayCloseBtn.className = "fixed top-4 right-4 z-60 text-gray-600 bg-white rounded-full p-1 shadow";
            overlayCloseBtn.type = "button";
            overlayCloseBtn.setAttribute("aria-label", "Close");
            overlayCloseBtn.innerHTML = "×";
            overlayCloseBtn.addEventListener("click", (ev) => {
                try {
                    ev.preventDefault();
                    ev.stopPropagation();
                } catch (e) {
                }
                close();
            });
            overlay.appendChild(overlayCloseBtn);

            const actionsRow = document.createElement("div");
            actionsRow.className = "mb-4 flex justify-center gap-2";

            const secondaryBtn = document.createElement("button");
            secondaryBtn.className = "btn btn-secondary text-xs";
            secondaryBtn.type = "button";
            secondaryBtn.textContent = opts.secondaryLabel ?? "Cancel";
            secondaryBtn.addEventListener("click", (ev) => {
                try {
                    ev.preventDefault();
                    ev.stopPropagation();
                } catch (e) {
                }
                try {
                    opts.onSecondary?.();
                } catch (e) {
                }
                close();

                try {
                    const liveShop = document.querySelector("match-shop") as any | null;
                    if (liveShop && liveShop.getAttribute("data-modal-open") === "true" && typeof liveShop.close === "function") {
                        liveShop.close();
                    }
                } catch (e) {
                }
            });

            const primaryBtn = document.createElement("button");
            primaryBtn.className = "btn btn-primary text-xs";
            primaryBtn.type = "button";
            primaryBtn.textContent = opts.primaryLabel;
            if (opts.primaryDisabled) {
                primaryBtn.disabled = true;
                primaryBtn.classList.add("opacity-50", "cursor-not-allowed");
            }
            primaryBtn.addEventListener("click", (ev) => {
                try {
                    ev.preventDefault();
                    ev.stopPropagation();
                } catch (e) {
                }
                try {
                    opts.onPrimary();
                } catch (e) {
                }
                close();
                try {
                    const liveShop = document.querySelector("match-shop") as any | null;
                    if (liveShop && liveShop.getAttribute("data-modal-open") === "true" && typeof liveShop.close === "function") {
                        liveShop.close();
                    }
                } catch (e) {
                }
            });

            actionsRow.appendChild(secondaryBtn);
            actionsRow.appendChild(primaryBtn);
            inner.appendChild(actionsRow);

            overlay.addEventListener("click", (ev) => {
                if (ev.target === overlay) close();
            });

            overlay.appendChild(inner);
            document.body.appendChild(overlay);
        }

        private showTempNotification(msg: string) {
            const el = document.createElement('div');
            el.className = 'fixed bottom-24 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded shadow';
            el.textContent = msg;
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 1500);
        }

        private squaredDist(ax: number, ay: number, bx: number, by: number) {
            const dx = ax - bx;
            const dy = ay - by;
            return dx * dx + dy * dy;
        }

        private createCardGhost(card: MatchCard, wrapperClass: string) {
            const ghost = document.createElement("div");
            ghost.className = "match-card-ghost";
            ghost.style.position = "fixed";
            ghost.style.pointerEvents = "none";
            ghost.style.zIndex = "100";
            ghost.style.left = "0px";
            ghost.style.top = "0px";

            const typeLabel =
                card.type ? card.type.charAt(0).toUpperCase() + card.type.slice(1) : "";
            const stats = (card as any).stats ?? "";
            const imageUrl = card.image || "/assets/placeholder.png";

            const mc = document.createElement("match-card") as any;
            mc.setAttribute("card-id", card.id);
            mc.setAttribute("name", card.name);
            mc.setAttribute("cost", String(card.cost ?? 0));
            mc.setAttribute("image", imageUrl);
            mc.setAttribute("type", typeLabel);
            mc.setAttribute("rarity", String(card.rarity ?? ""));
            mc.setAttribute("stats", String(stats));
            mc.setAttribute("compact", "");
            mc.className = `${wrapperClass} match-card-ghost-card`;

            ghost.appendChild(mc);
            document.body.appendChild(ghost);
            return ghost;
        }

        private findBoardIndexAt(x: number, y: number): number | null {
            const buttons = Array.from(this.querySelectorAll("button[data-zone='board']")) as HTMLElement[];
            for (const b of buttons) {
                const r = b.getBoundingClientRect();
                if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                    const idx = Number(b.dataset.index ?? "-1");
                    return idx >= 0 ? idx : null;
                }
            }
            return null;
        }

        private isInsideShopGrid(x: number, y: number): boolean {
            const shopGrid = this.querySelector("[data-role='shop-grid']") as HTMLElement | null;
            if (!shopGrid) return false;
            const r = shopGrid.getBoundingClientRect();
            return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        }

        private isInsideHandArea(x: number, y: number): boolean {
            const hand = this.contentRoot?.querySelector("match-hand") as HTMLElement | null;
            const handArea = hand?.querySelector("[data-role='hand-area']") as HTMLElement | null;
            if (!handArea) return false;
            const r = handArea.getBoundingClientRect();
            return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        }

        private isInsideMobileShop(x: number, y: number): boolean {
            try {
                const btn = this.contentRoot?.querySelector('#btn-mobile-shop') as HTMLElement | null;
                if (!btn) return false;
                const rect = btn.getBoundingClientRect();
                return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
            } catch (e) {
                return false;
            }
        }

        private clearGhost() {
            if (this.drag.ghost) this.drag.ghost.remove();
            this.drag.ghost = null;
        }

        private resetDrag() {
            this.drag.active = false;
            this.drag.ctx = null;
            this.drag.cardId = null;
            this.drag.boardIndex = null;
            this.drag.exceeded = false;
            this.clearGhost();
            this.clearBoardHighlights();
        }

        private pendingEndRound = false;
        private pendingForfeit = false;
        private pendingCooldownMs = 2000;
        private pendingReroll = false;
        private pendingUpgrade = false;

        private requestEndRound = () => {
            try {
                if (this.pendingEndRound) {
                    debug('[match-screen] requestEndRound ignored: pending');
                    return;
                }
                this.pendingEndRound = true;
                try {
                    if (state.matchId) matchEndRound(state.matchId);
                } catch (e) {
                }

                try {
                    const btn = this.$('#btn-end-round') as HTMLButtonElement | null;
                    if (btn) btn.setAttribute('disabled', 'true');
                } catch (e) {
                }

                window.setTimeout(() => {
                    this.pendingEndRound = false;
                    try {
                        const btn = this.$('#btn-end-round') as HTMLButtonElement | null;
                        if (btn) btn.removeAttribute('disabled');
                    } catch (e) {
                    }
                }, this.pendingCooldownMs);
            } catch (e) {
                this.pendingEndRound = false;
            }
        };

        private requestForfeit = () => {
            try {
                if (this.pendingForfeit) {
                    debug('[match-screen] requestForfeit ignored: pending');
                    return;
                }
                this.pendingForfeit = true;
                try {
                    if (state.matchId) matchForfeit(state.matchId);
                } catch (e) {
                }
                try {
                    const btn = this.$('#btn-forfeit') as HTMLButtonElement | null;
                    if (btn) btn.setAttribute('disabled', 'true');
                } catch (e) {
                }
                window.setTimeout(() => {
                    this.pendingForfeit = false;
                    try {
                        const btn = this.$('#btn-forfeit') as HTMLButtonElement | null;
                        if (btn) btn.removeAttribute('disabled');
                    } catch (e) {
                    }
                }, this.pendingCooldownMs);
            } catch (e) {
                this.pendingForfeit = false;
            }
        };
    }
);

