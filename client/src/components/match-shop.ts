/**
 * match-shop.ts
 *
 * Shop component that renders shop cards and provides modal UI for mobile and
 * desktop. Contains logic for modal slides, reroll/buy interactions and exposes
 * `open` for mobile usage via the `[data-role="shop-open-mobile"]` listener.
 */

import {type MatchState, state} from "../core/store";
import {debug} from "../core/log";

const GLOBAL_MODAL_ID = 'match-shop-modal-global';

class MatchShop extends HTMLElement {
    private modalEl: HTMLElement | null = null;
    private modalInner: HTMLElement | null = null;
    private modalActionsContainer: HTMLElement | null = null;
    private isOpen = false;
    private lastMatch: MatchState | null = null;
    private modalCleanup: (() => void) | null = null;
    private modalGlobalCleanup: (() => void) | null = null;

    connectedCallback() {
        window.addEventListener("resize", this.onWindowResize);
    }

    disconnectedCallback() {
        window.removeEventListener("resize", this.onWindowResize);
        this.teardownModal();
    }

    set match(m: MatchState) {
        this.lastMatch = m;
        this.render(m);
        this.attachUIHandlers();
        try {
            const g = document.getElementById(GLOBAL_MODAL_ID) as HTMLElement | null;
            if (g && g.style.display && g.style.display !== 'none') {

                this.ensureModal();
                try {
                    this.refreshModalSlides();
                } catch (e) {
                }
            }
        } catch (e) {
        }
        try {
            this.updateModalRerollButtonState();
        } catch (e) {
        }
        try {
            this.updateModalActionsRerollState(this.modalActionsContainer);
        } catch (e) {
        }
    }

    private refreshModalSlides() {
        if (!this.modalInner) return;
        try {
            const ids = Array.isArray(this.lastMatch?.shopIds) ? this.lastMatch!.shopIds : [];
            const getCardById = (id: string) => (window as any).getCardById?.(id) || null;

            while (this.modalInner.firstChild) this.modalInner.removeChild(this.modalInner.firstChild);

            for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                const card = getCardById(id);
                if (!card) continue;

                const slide = this.createModalSlide(card);
                const overlapX = 44;
                if (i > 0) slide.style.marginLeft = `-${overlapX}px`;
                this.modalInner.appendChild(slide);
            }

            requestAnimationFrame(() => {
                try {
                    const first = this.modalInner!.querySelector('.shop-card-modal-slide') as HTMLElement | null;
                    if (first) {
                        const container = this.modalInner as HTMLElement;
                        const containerCenter = container.clientWidth / 2;
                        const targetLeft = first.offsetLeft + (first.clientWidth / 2) - containerCenter;
                        container.scrollTo({left: targetLeft, behavior: 'auto'});
                    }
                } catch (e) {
                }
                try {
                    this.syncModalActionsToCenteredSlide();
                } catch (e) {
                }
            });
            try {
                this.updateModalRerollButtonState();
            } catch (e) {
            }
            try {
                this.updateModalActionsRerollState(this.modalActionsContainer);
            } catch (e) {
            }
        } catch (e) {
        }
    }

    private updateModalRerollButtonState() {
        try {
            const lm = this.lastMatch ?? state.matchState ?? null;
            const isFinished = lm?.phase === 'finished';
            const rerollCost = lm?.rerollCost ?? 0;
            const canReroll = !isFinished && (lm?.gold ?? 0) >= rerollCost;
            const mobileOpenBtn = this.querySelector('[data-role="shop-open-mobile"]') as HTMLElement | null;
            const modalReroll = this.querySelector('[data-role="shop-open-mobile-reroll"]') as HTMLButtonElement | null;
            if (!modalReroll || !mobileOpenBtn) return;
            if (canReroll) {
                modalReroll.classList.remove('bg-gray-100', 'border-gray-200', 'text-gray-400', 'cursor-not-allowed');
                modalReroll.classList.add('bg-amber-500', 'border-amber-600', 'text-white', 'shadow-sm');
                modalReroll.removeAttribute('disabled');
                modalReroll.setAttribute('title', `Reroll (${rerollCost}g)`);
            } else {
                modalReroll.classList.remove('bg-amber-500', 'border-amber-600', 'text-white', 'shadow-sm');
                modalReroll.classList.add('bg-gray-100', 'border-gray-200', 'text-gray-400', 'cursor-not-allowed');
                modalReroll.setAttribute('disabled', 'true');
                modalReroll.setAttribute('title', `Reroll (${rerollCost}g)`);
            }
        } catch (e) {
        }
    }

    private updateModalActionsRerollState(actionsEl: HTMLElement | null) {
        try {
            if (!actionsEl) return;
            const lm = this.lastMatch ?? state.matchState ?? null;
            const isFinished = lm?.phase === 'finished';
            const rerollCost = lm?.rerollCost ?? 0;
            const canReroll = !isFinished && (lm?.gold ?? 0) >= rerollCost;
            const rerollBtn = actionsEl.querySelector('[data-action="reroll"]') as HTMLButtonElement | null;
            if (!rerollBtn) return;
            if (canReroll) {
                rerollBtn.classList.remove('bg-gray-100', 'border-gray-200', 'text-gray-400', 'cursor-not-allowed');
                rerollBtn.classList.add('bg-amber-500', 'border-amber-600', 'text-white', 'shadow-sm');
                rerollBtn.removeAttribute('disabled');
                rerollBtn.setAttribute('title', `Reroll (${rerollCost}g)`);
            } else {
                rerollBtn.classList.remove('bg-amber-500', 'border-amber-600', 'text-white', 'shadow-sm');
                rerollBtn.classList.add('bg-gray-100', 'border-gray-200', 'text-gray-400', 'cursor-not-allowed');
                rerollBtn.setAttribute('disabled', 'true');
                rerollBtn.setAttribute('title', `Reroll (${rerollCost}g)`);
            }
        } catch (e) {
        }
    }

    private onWindowResize = () => {
        this.attachUIHandlers();
    };

    private attachUIHandlers() {
        const mobileOpenBtn = this.querySelector('[data-role="shop-open-mobile"]') as HTMLButtonElement | null;
        const isMobile = window.innerWidth < 640;
        if (mobileOpenBtn) mobileOpenBtn.style.display = isMobile ? "inline-flex" : "none";

        const rerollBtn = this.querySelector("#btn-reroll") as HTMLButtonElement | null;
        if (rerollBtn) {
            rerollBtn.onclick = () => {
                try {
                    document.dispatchEvent(new CustomEvent("shop:reroll", {bubbles: true, composed: true}));
                } catch (e) {
                }
            };
        }

        try {
            if (!(window as any).__matchShopMobileHandlerInstalled) {
                document.addEventListener('click', (ev) => {
                    try {
                        const path = (ev as any).composedPath ? (ev as any).composedPath() : [ev.target];
                        for (const p of path) {
                            if (!p || !(p instanceof Element)) continue;
                            if ((p as Element).matches && (p as Element).matches('[data-role="shop-open-mobile"]')) {
                                const btn = p as HTMLElement;
                                if (btn.hasAttribute('disabled')) return;
                                let shopEl = btn.closest('match-shop') as any;
                                if (!shopEl) shopEl = document.querySelector('match-shop') as any;
                                if (shopEl && typeof shopEl.open === 'function') {
                                    try {
                                        shopEl.open();
                                        ev.preventDefault();
                                        return;
                                    } catch (e) {
                                    }
                                }
                            }
                        }
                    } catch (e) {
                    }
                }, true);
                (window as any).__matchShopMobileHandlerInstalled = true;
            }
        } catch (e) {
        }

        if (mobileOpenBtn) {
            mobileOpenBtn.onclick = () => {
                if (mobileOpenBtn.hasAttribute("disabled")) return;
                this.openModal();
            };
        }

        this.updateMobileBadge();
    }

    private updateMobileBadge() {
        try {
            const mobileOpenBtn = this.querySelector('[data-role="shop-open-mobile"]') as HTMLButtonElement | null;
            const shopCount = Array.isArray(this.lastMatch?.shopIds)
                ? this.lastMatch!.shopIds.length
                : Array.isArray(state.matchState?.shopIds)
                    ? state.matchState!.shopIds.length
                    : 0;
            if (!mobileOpenBtn) return;
            const badge = mobileOpenBtn.querySelector('[data-role="shop-mobile-badge"]') as HTMLElement | null;
            if (!badge) return;
            badge.textContent = String(shopCount);
            if (shopCount === 0) {
                badge.classList.remove("bg-red-600", "text-white");
                badge.classList.add("bg-gray-300", "text-gray-700");
                mobileOpenBtn.setAttribute("disabled", "true");
                mobileOpenBtn.setAttribute("aria-disabled", "true");
                mobileOpenBtn.classList.add("opacity-50", "cursor-not-allowed");
            } else {
                badge.classList.remove("bg-gray-300", "text-gray-700");
                badge.classList.add("bg-red-600", "text-white");
                mobileOpenBtn.removeAttribute("disabled");
                mobileOpenBtn.removeAttribute("aria-disabled");
                mobileOpenBtn.classList.remove("opacity-50", "cursor-not-allowed");
            }
        } catch (e) {
        }
    }

    private ensureModal() {
        const existing = document.getElementById(GLOBAL_MODAL_ID) as HTMLElement | null;
        if (existing) {
            this.modalEl = existing;
            this.modalInner = existing.querySelector('.shop-modal-inner') as HTMLElement | null;
            this.modalActionsContainer = existing.querySelector('.shop-modal-actions') as HTMLElement | null;
            if (this.modalInner) {
                this.attachDragHandlers(this.modalInner);
                this.attachScrollHighlight(this.modalInner);
            }

            if (!existing.getAttribute('data-actions-init')) {
                try {
                    const actionsEl = existing.querySelector('.shop-modal-actions') as HTMLElement | null;
                    if (actionsEl) {
                        const handler = (ev: Event) => {
                            try {
                                const path = (ev as any).composedPath ? (ev as any).composedPath() : [];
                                let el: Element | null = null;
                                if (Array.isArray(path) && path.length > 0) {
                                    for (const p of path) {
                                        if (p && p instanceof Element) {
                                            el = p as Element;
                                            break;
                                        }
                                    }
                                }
                                if (!el && ev.target instanceof Element) el = ev.target as Element;
                                if (!el) return;
                                if (el.closest('[data-action="buy"]')) {
                                    const cardId = actionsEl.getAttribute('data-active-card') || '';
                                    const costAttr = actionsEl.getAttribute('data-active-cost');
                                    const cost = costAttr != null && costAttr !== '' ? Number(costAttr) : undefined;
                                    document.dispatchEvent(new CustomEvent('shop:buy', {
                                        bubbles: true,
                                        composed: true,
                                        detail: {cardId, cost}
                                    }));
                                    try {
                                        existing.style.display = 'none';
                                        document.body.style.overflow = '';
                                        document.body.classList.remove('shop-modal-open-block');
                                        existing.removeAttribute('data-modal-open');
                                    } catch (e) {
                                    }
                                    return;
                                }

                                if (el.closest('[data-action="cancel"]')) {
                                    try {
                                        existing.style.display = 'none';
                                        document.body.style.overflow = '';
                                        document.body.classList.remove('shop-modal-open-block');
                                        existing.removeAttribute('data-modal-open');
                                    } catch (e) {
                                    }
                                    return;
                                }

                                if (el.closest('[data-action="reroll"]')) {
                                    try {
                                        existing.setAttribute('data-modal-keep-open', '1');
                                    } catch (e) {
                                    }
                                    try {
                                        document.dispatchEvent(new CustomEvent('shop:reroll', {
                                            bubbles: true,
                                            composed: true
                                        }));
                                    } catch (e) {
                                    }
                                    return;
                                }
                            } catch (e) {
                            }
                        };
                        actionsEl.addEventListener('click', handler);
                        existing.setAttribute('data-actions-init', '1');
                    }
                } catch (e) {
                }
            }

            if (existing.getAttribute('data-modal-keep-open') === '1') {
                try {
                    existing.style.display = 'flex';
                    document.body.classList.add('shop-modal-open-block');
                    document.body.style.overflow = 'hidden';
                } catch (e) {
                }
                existing.removeAttribute('data-modal-keep-open');
            }
            return;
        }

        const overlay = document.createElement("div");
        overlay.id = GLOBAL_MODAL_ID;
        overlay.className = "shop-modal fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm";
        overlay.style.display = "none";
        overlay.addEventListener("click", (ev) => {
            if (ev.target === overlay) this.closeModal();
        });

        const innerWrap = document.createElement("div");
        innerWrap.className = "shop-modal-wrap w-full h-full flex items-center justify-center p-0 sm:p-4";

        const content = document.createElement("div");
        content.className = "shop-modal-content relative w-full h-full flex flex-col items-center justify-center";

        const carouselOuter = document.createElement("div");
        carouselOuter.className = "shop-modal-carousel w-full h-full flex items-center justify-center";

        const carouselInner = document.createElement("div");
        const slideWidth = 200;
        const slideHalf = slideWidth / 2;
        carouselInner.className = "shop-modal-inner flex gap-0 touch-pan-x snap-x snap-mandatory px-0 py-6 w-full";
        (carouselInner.style as any).scrollSnapType = "x mandatory";
        (carouselInner.style as any).scrollBehavior = "smooth";
        (carouselInner.style as any).paddingLeft = `calc(50vw - ${slideHalf}px)`;
        (carouselInner.style as any).paddingRight = `calc(50vw - ${slideHalf}px)`;
        carouselInner.tabIndex = 0;

        carouselInner.addEventListener('click', (ev) => {
            try {
                const slide = (ev.target as HTMLElement | null)?.closest('.shop-card-modal-slide');
                if (slide) {
                    ev.preventDefault();
                    ev.stopPropagation();
                }
            } catch (e) {
            }
        }, {capture: true});

        carouselOuter.appendChild(carouselInner);

        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'shop-modal-actions w-full flex items-center justify-center py-3';

        content.appendChild(carouselOuter);
        content.appendChild(actionsContainer);
        innerWrap.appendChild(content);
        overlay.appendChild(innerWrap);

        try {
            document.body.appendChild(overlay);
            this.modalEl = overlay;
            this.modalInner = carouselInner;
            this.modalActionsContainer = actionsContainer;
        } catch (e) {
        }

        this.attachDragHandlers(carouselInner);
        this.attachScrollHighlight(carouselInner);

        try {
            if (!overlay.getAttribute('data-actions-init')) {
                const actionsHandler = (ev: Event) => {
                    try {
                        const path = (ev as any).composedPath ? (ev as any).composedPath() : [];
                        let el: Element | null = null;
                        if (Array.isArray(path) && path.length > 0) {
                            for (const p of path) {
                                if (p && p instanceof Element) {
                                    el = p as Element;
                                    break;
                                }
                            }
                        }
                        if (!el && ev.target instanceof Element) el = ev.target as Element;
                        if (!el) return;

                        if (el.closest('[data-action="buy"]')) {
                            const cardId = actionsContainer.getAttribute('data-active-card') || '';
                            const costAttr = actionsContainer.getAttribute('data-active-cost');
                            const cost = costAttr != null && costAttr !== '' ? Number(costAttr) : undefined;
                            document.dispatchEvent(new CustomEvent('shop:buy', {
                                bubbles: true,
                                composed: true,
                                detail: {cardId, cost}
                            }));
                            try {
                                overlay.style.display = 'none';
                                document.body.style.overflow = '';
                                document.body.classList.remove('shop-modal-open-block');
                                overlay.removeAttribute('data-modal-open');
                            } catch (e) {
                            }
                            return;
                        }

                        if (el.closest('[data-action="cancel"]')) {
                            try {
                                overlay.style.display = 'none';
                                document.body.style.overflow = '';
                                document.body.classList.remove('shop-modal-open-block');
                                overlay.removeAttribute('data-modal-open');
                            } catch (e) {
                            }
                            return;
                        }

                        if (el.closest('[data-action="reroll"]')) {
                            try {
                                overlay.setAttribute('data-modal-keep-open', '1');
                            } catch (e) {
                            }
                            try {
                                document.dispatchEvent(new CustomEvent('shop:reroll', {bubbles: true, composed: true}));
                            } catch (e) {
                            }
                            return;
                        }
                    } catch (e) {
                    }
                };

                actionsContainer.addEventListener('click', actionsHandler);
                overlay.setAttribute('data-actions-init', '1');
            }
        } catch (e) {
        }
    }

    private teardownModal() {
        const global = document.getElementById(GLOBAL_MODAL_ID) as HTMLElement | null;

        try {
            document.body.classList.remove('shop-modal-open-block');
        } catch (e) {
        }

        if (global) {
            this.modalEl = null;
            this.modalInner = null;
            this.modalActionsContainer = null;
            this.isOpen = false;
            this.modalCleanup = null;
            this.modalGlobalCleanup = null;
            return;
        }

        if (!this.modalEl) return;
        if (this.modalCleanup) {
            try {
                this.modalCleanup();
            } catch (e) {
            }
            this.modalCleanup = null;
        }
        if (this.modalGlobalCleanup) {
            try {
                this.modalGlobalCleanup();
            } catch (e) {
            }
            this.modalGlobalCleanup = null;
        }

        try {
            if (this.modalInner) {
                while (this.modalInner.firstChild) this.modalInner.removeChild(this.modalInner.firstChild);
            }
        } catch (e) {
        }

        try {
            this.modalEl.remove();
        } catch (e) {
        }

        this.modalEl = null;
        this.modalInner = null;
        this.modalActionsContainer = null;
        this.isOpen = false;
    }

    private openModal() {
        this.ensureModal();
        if (!this.modalEl || !this.modalInner) return;
        try {
            this.refreshModalSlides();
        } catch (e) {
        }
        try {
            if (this.modalInner) {
                const slides = Array.from(this.modalInner.querySelectorAll('.shop-card-modal-slide')) as HTMLElement[];
                for (const slide of slides) {
                    try {
                        const innerBtn = slide.querySelector('button.match-card-tile') as HTMLButtonElement | null;
                        if (innerBtn) {
                            innerBtn.disabled = true;
                            innerBtn.setAttribute('aria-hidden', 'true');
                            innerBtn.style.pointerEvents = 'none';
                        }
                        slide.setAttribute('data-modal-noninteractive', 'true');
                    } catch (e) {
                    }
                }
            }
        } catch (e) {
        }
        this.modalEl.style.display = "flex";
        try {
            document.body.classList.add('shop-modal-open-block');
        } catch (e) {
        }
        document.body.style.overflow = "hidden";
        this.isOpen = true;
        try {
            this.setAttribute("data-modal-open", "true");
        } catch (e) {
        }
        try {
            try {
                const lm = this.lastMatch ?? state.matchState ?? null;
                const isFinished = lm?.phase === 'finished';
                const rerollCost = lm?.rerollCost ?? 0;
                const canReroll = !isFinished && (lm?.gold ?? 0) >= rerollCost;
                const mobileOpenBtn = this.querySelector('[data-role="shop-open-mobile"]') as HTMLButtonElement | null;
                if (mobileOpenBtn) {
                    let modalReroll = this.querySelector('[data-role="shop-open-mobile-reroll"]') as HTMLButtonElement | null;
                    if (!modalReroll) {
                        modalReroll = document.createElement('button');
                        modalReroll.setAttribute('data-role', 'shop-open-mobile-reroll');
                        modalReroll.type = 'button';
                        modalReroll.className = 'inline-flex items-center gap-1 rounded-full border px-2 py-1 ml-2 text-[10px]';
                        modalReroll.style.pointerEvents = 'auto';
                        modalReroll.innerHTML = `<span class="font-semibold">Reroll</span><span class="inline-flex items-center gap-0.5 text-[10px]"><span class="inline-block w-3 h-3 rounded-full bg-amber-400 border border-amber-500"></span><span class="font-semibold">${rerollCost}</span></span>`;

                        try {
                            mobileOpenBtn.insertAdjacentElement('afterend', modalReroll);
                        } catch (e) {
                            mobileOpenBtn.parentElement?.appendChild(modalReroll);
                        }

                        const modalRerollBtn = modalReroll as HTMLButtonElement;
                        modalRerollBtn.addEventListener('click', (ev) => {
                            if ((ev.target as HTMLElement).closest('[disabled]')) return;
                            try {
                                try {
                                    document.dispatchEvent(new CustomEvent('shop:reroll', {
                                        bubbles: true,
                                        composed: true
                                    }));
                                } catch (e) {
                                }
                            } catch (e) {
                            }
                        });
                    }
                    const modalRerollEl = this.querySelector('[data-role="shop-open-mobile-reroll"]') as HTMLButtonElement | null;
                    if (modalRerollEl) {
                        if (canReroll) {
                            modalRerollEl.classList.remove('bg-gray-100', 'border-gray-200', 'text-gray-400', 'cursor-not-allowed');
                            modalRerollEl.classList.add('bg-amber-500', 'border-amber-600', 'text-white', 'shadow-sm');
                            modalRerollEl.removeAttribute('disabled');
                            modalRerollEl.setAttribute('title', `Reroll (${rerollCost}g)`);
                        } else {
                            modalRerollEl.classList.remove('bg-amber-500', 'border-amber-600', 'text-white', 'shadow-sm');
                            modalRerollEl.classList.add('bg-gray-100', 'border-gray-200', 'text-gray-400', 'cursor-not-allowed');
                            modalRerollEl.setAttribute('disabled', 'true');
                            modalRerollEl.setAttribute('title', `Reroll (${rerollCost}g)`);
                        }
                        modalRerollEl.style.display = 'inline-flex';
                    }
                }
            } catch (e) {
            }
            const first = this.modalInner.querySelector('.shop-card-modal-slide') as HTMLElement | null;
            if (first) {
                try {
                    setTimeout(() => {
                        try {
                            const container = this.modalInner as HTMLElement;
                            const containerCenter = container.clientWidth / 2;
                            const targetLeft = first.offsetLeft + (first.clientWidth / 2) - containerCenter;
                            container.scrollTo({left: targetLeft, behavior: 'auto'});

                            container.dispatchEvent(new Event('scroll'));
                        } catch (err) {
                        }
                    }, 20);
                } catch (e) {
                }
            }
        } catch (e) {
        }

        try {
            this.modalInner.focus();
        } catch (e) {
        }
        try {
            this.modalInner.dispatchEvent(new Event('scroll'));
        } catch (e) {
        }
        try {
            this.updateModalActionsRerollState(this.modalActionsContainer);
        } catch (e) {
        }
    }

    private closeModal() {
        if (!this.modalEl || !this.modalInner) return;
        this.modalEl.style.display = "none";
        document.body.style.overflow = "";
        this.isOpen = false;
        try {
            this.removeAttribute('data-modal-open');
        } catch (e) {
        }
        try {
            document.body.classList.remove('shop-modal-open-block');
        } catch (e) {
        }
        // remove modal-only reroll button next to mobile open button
        try {
            const modalReroll = this.querySelector('[data-role="shop-open-mobile-reroll"]') as HTMLElement | null;
            if (modalReroll) modalReroll.remove();
        } catch (e) {
        }
        // cleanup global capture handlers added during ensureModal()
        try {
            if (this.modalGlobalCleanup) {
                this.modalGlobalCleanup();
                this.modalGlobalCleanup = null;
            }
        } catch (e) {
        }
    }

    private createModalSlide(card: any) {
        const slide = document.createElement('div');
        slide.className = 'shop-card-modal-slide snap-center shrink-0 flex flex-col items-center justify-start';
        slide.style.scrollSnapAlign = 'center';
        slide.style.paddingBottom = '1rem';
        slide.style.boxSizing = 'border-box';
        slide.style.width = '200px';
        slide.setAttribute('data-card-id', card.id);

        const tl = document.createElement('tl-card') as any;
        if (card.name) tl.setAttribute('name', card.name);
        if (card.cost != null) tl.setAttribute('cost', String(card.cost));
        if (card.type) tl.setAttribute('type', card.type);
        if (card.rarity) tl.setAttribute('rarity', card.rarity);
        if (card.image) tl.setAttribute('image', card.image);
        if (card.description) tl.setAttribute('description', card.description || '');
        if (card.stats) tl.setAttribute('stats', card.stats || '');
        tl.classList.add('detail-card');
        tl.style.pointerEvents = 'none';
        tl.style.maxHeight = '52vh';
        tl.style.width = '100%';
        tl.style.boxSizing = 'border-box';

        const wrapper = document.createElement('div');
        wrapper.className = 'shop-card-wrapper modal-slide-wrapper';
        wrapper.appendChild(tl);
        slide.appendChild(wrapper);

        try {
            slide.addEventListener('click', (ev: Event) => {
                try {
                    ev.preventDefault();
                    (ev as any).stopImmediatePropagation();
                } catch (e) {
                }
            }, {capture: true});

            let sX = 0;
            let sY = 0;
            let sT = 0;
            slide.addEventListener('touchstart', (tev: TouchEvent) => {
                try {
                    const t = tev.touches && tev.touches[0];
                    if (!t) return;
                    sX = t.clientX;
                    sY = t.clientY;
                    sT = Date.now();
                } catch (e) {
                }
            }, {passive: true, capture: true});
            slide.addEventListener('touchend', (tev: TouchEvent) => {
                try {
                    const t = tev.changedTouches && tev.changedTouches[0];
                    if (!t) return;
                    const dx = Math.abs(t.clientX - sX);
                    const dy = Math.abs(t.clientY - sY);
                    const dt = Date.now() - sT;
                    if (dx <= 12 && dy <= 12 && dt <= 300) {
                        tev.preventDefault();
                        tev.stopImmediatePropagation();
                    }
                } catch (e) {
                }
            }, {passive: false, capture: true});
        } catch (e) {
        }
        return slide;
    }

    render(m: MatchState) {
        const isFinished = m.phase === "finished";
        const canReroll = !isFinished && (m.gold ?? 0) >= (m.rerollCost ?? 0);
        const shopCount = Array.isArray(m.shopIds) ? m.shopIds.length : 0;
        try {
            debug('[match-shop] render shopCount=', shopCount, 'matchId=', m.matchId ?? null);
        } catch (e) {
        }

        this.innerHTML = `
    <section class="card flex flex-col gap-3 ${isFinished ? "opacity-60 pointer-events-none" : ""}">
      <div class="flex items-center justify-between mb-1">
        <h2 class="text-sm font-semibold text-gray-800">Shop</h2>
        <div class="flex items-center gap-2">
          <button id="btn-reroll" type="button" class="inline-flex items-center gap-1 rounded-full border px-2 py-1 ml-2 text-[10px] ${
            canReroll
                ? "bg-amber-500 border-amber-600 text-white shadow-sm hover:bg-amber-600"
                : "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"
        }" ${canReroll ? "" : "disabled"} title="Reroll (${m.rerollCost}g)">
            <span class="font-semibold">Reroll</span>
            <span class="inline-flex items-center gap-0.5 text-[10px]"><span class="inline-block w-3 h-3 rounded-full bg-amber-400 border border-amber-500"></span><span class="font-semibold">${m.rerollCost}</span></span>
          </button>

          <!-- Mobile: open full-screen carousel -->
          <button data-role="shop-open-mobile" class="relative inline-flex items-center gap-1 rounded-full border px-2 py-1 ml-2 text-[10px] sm:hidden bg-white/60 overflow-visible" ${shopCount === 0 ? 'disabled aria-disabled="true"' : ''} aria-label="Open Shop">
            <span data-role="shop-mobile-badge" class="absolute -top-2 -right-2 w-5 h-5 rounded-full text-[10px] flex items-center justify-center ${shopCount > 0 ? 'bg-red-600 text-white' : 'bg-gray-300 text-gray-700'}" style="z-index:999; pointer-events:none">${shopCount}</span>
            Open Shop
          </button>
         </div>
       </div>

      <div class="shop-grid w-full flex gap-2 text-xs overflow-x-auto sm:grid sm:grid-cols-5 sm:overflow-visible sm:gap-2 px-4 sm:px-0" data-role="shop-grid">
        ${this.renderCardRow(m)}
      </div>
    </section>
    `;

        setTimeout(() => this.updateMobileBadge(), 0);
    }

    renderCardRow(m: MatchState): string {
        const getCardById = (id: string) => (window as any).getCardById?.(id) || null;
        const ids = Array.isArray(m.shopIds) ? m.shopIds : [];
        if (ids.length === 0) return `<div class="shop-empty p-2 text-center text-sm text-gray-500">No shop offers — reroll to refresh</div>`;
        return ids.map((id: string) => {
            const card = getCardById(id);
            if (!card) return "";
            const typeLabel = (card.type || "").charAt(0).toUpperCase() + (card.type || "").slice(1);
            const stats = card.stats || "";
            const imageUrl = card.image || "/assets/placeholder.png";
            const notEnough = (m.gold ?? 0) < (card.cost ?? 0);
            return `
  <div class="shop-card-slide snap-center shrink-0 w-[min(420px,90vw)] sm:w-auto max-h-[90vh] overflow-auto">
    <div class="shop-card-wrapper ${notEnough ? 'card-disabled' : ''}">
      <match-card card-id="${card.id}"
                  name="${card.name}"
                  cost="${card.cost}"
                  image="${imageUrl}"
                  type="${typeLabel}"
                  rarity="${card.rarity}"
                  stats="${stats}"
                  ${notEnough ? 'not-enough' : ''}
                  data-card-id="${card.id}"
                  data-context="shop"
                  compact></match-card>
    </div>
  </div>
`;
        }).join("");
    }

    private attachScrollHighlight(el: HTMLElement) {
        if (!el) return;

        // Attach once per global modal inner element.
        if ((el as any).__matchShopScrollInit) return;
        (el as any).__matchShopScrollInit = true;

        let ticking = false;
        let rafId: number | null = null;

        const getGlobal = () => document.getElementById(GLOBAL_MODAL_ID) as HTMLElement | null;
        const getActions = () => getGlobal()?.querySelector('.shop-modal-actions') as HTMLElement | null;

        const renderActionsForSlide = (slide: HTMLElement) => {
            const actions = getActions();
            if (!actions) return;
            const cardId = slide.getAttribute('data-card-id') || '';
            const tl = slide.querySelector('tl-card') as any;
            const costRaw = tl?.getAttribute('cost');
            const costNum = costRaw != null && costRaw !== '' ? Number(costRaw) : 0;

            actions.setAttribute('data-active-card', cardId);
            actions.setAttribute('data-active-cost', String(costNum));

            const lm = state.matchState ?? null;
            const isFinished = lm?.phase === 'finished';
            const rerollCost = lm?.rerollCost ?? 0;
            const canReroll = !isFinished && (lm?.gold ?? 0) >= rerollCost;

            actions.innerHTML = `
      <button data-action="reroll" type="button"
        class="fixed left-15 bottom-4 shadow flex items-center justify-center overflow-visible gap-1 rounded-full border px-2 py-1 text-[8px] ${
                canReroll
                    ? 'bg-amber-500 border-amber-600 text-white shadow-sm hover:bg-amber-600'
                    : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
            }" ${canReroll ? '' : 'disabled'} title="Reroll (${rerollCost}g)">
        <span class="font-semibold">Reroll</span>
        <span class="inline-flex items-center gap-0.5 text-[8px]">
          <span class="inline-block w-3 h-3 rounded-full bg-amber-400 border border-amber-500"></span>
          <span class="font-semibold">${rerollCost}</span>
        </span>
      </button>

      <div class="modal-actions-inner flex gap-3 items-center">
        <button data-action="cancel" class="btn btn-secondary text-sm">Cancel</button>
        <button data-action="buy" class="btn btn-primary text-sm">Buy (${costNum}g)</button>
      </div>
    `;
        };

        const update = () => {
            ticking = false;

            const slides = Array.from(el.querySelectorAll('.shop-card-modal-slide')) as HTMLElement[];
            const actions = getActions();

            if (slides.length === 0) {
                if (actions) {
                    actions.innerHTML = '';
                    actions.removeAttribute('data-active-card');
                    actions.removeAttribute('data-active-cost');
                }
                return;
            }

            const rect = el.getBoundingClientRect();
            const center = rect.left + rect.width / 2;

            let best: HTMLElement | null = null;
            let bestDist = Infinity;

            for (const s of slides) {
                const r = s.getBoundingClientRect();
                const sCenter = r.left + r.width / 2;
                const d = Math.abs(sCenter - center);
                if (d < bestDist) {
                    bestDist = d;
                    best = s;
                }
                s.classList.remove('active-modal-slide');
            }

            if (!best) return;

            best.classList.add('active-modal-slide');
            renderActionsForSlide(best);
        };

        const onScroll = () => {
            if (!ticking) {
                ticking = true;
                if (rafId) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(update);
            }
        };

        el.addEventListener('scroll', onScroll);

        // Initial paint
        setTimeout(() => {
            try {
                el.dispatchEvent(new Event('scroll'));
            } catch (e) {
            }
        }, 30);
    }

    // Force actions bar to match the slide currently closest to center.
// Call this after rebuilding slides (reroll) so Buy uses the new cardId/cost.
    private syncModalActionsToCenteredSlide() {
        try {
            const el = this.modalInner;
            const actions = this.modalActionsContainer;
            if (!el || !actions) return;

            const children = Array.from(el.querySelectorAll('.shop-card-modal-slide')) as HTMLElement[];
            if (children.length === 0) {
                actions.innerHTML = '';
                actions.removeAttribute('data-active-card');
                actions.removeAttribute('data-active-cost');
                return;
            }

            const rect = el.getBoundingClientRect();
            const center = rect.left + rect.width / 2;

            let best: HTMLElement | null = null;
            let bestDist = Infinity;

            for (const c of children) {
                const r = c.getBoundingClientRect();
                const ccenter = r.left + r.width / 2;
                const d = Math.abs(ccenter - center);
                if (d < bestDist) {
                    bestDist = d;
                    best = c;
                }
                c.classList.remove('active-modal-slide');
            }

            if (!best) return;
            best.classList.add('active-modal-slide');

            const cardId = best.getAttribute('data-card-id') || '';
            const tl = best.querySelector('tl-card') as any;
            const costRaw = tl?.getAttribute('cost');
            const costNum = costRaw != null && costRaw !== '' ? Number(costRaw) : 0;

            actions.setAttribute('data-active-card', cardId);
            actions.setAttribute('data-active-cost', String(costNum));

            const lm = this.lastMatch ?? state.matchState ?? null;
            const isFinished = lm?.phase === 'finished';
            const rerollCost = lm?.rerollCost ?? 0;
            const canReroll = !isFinished && (lm?.gold ?? 0) >= rerollCost;

            actions.innerHTML = `
      <button data-action="reroll" type="button"
        class="fixed left-15 bottom-4 shadow flex items-center justify-center overflow-visible gap-1 rounded-full border px-2 py-1 text-[8px] ${
                canReroll
                    ? 'bg-amber-500 border-amber-600 text-white shadow-sm hover:bg-amber-600'
                    : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
            }" ${canReroll ? '' : 'disabled'} title="Reroll (${rerollCost}g)">
        <span class="font-semibold">Reroll</span>
        <span class="inline-flex items-center gap-0.5 text-[8px]">
          <span class="inline-block w-3 h-3 rounded-full bg-amber-400 border border-amber-500"></span>
          <span class="font-semibold">${rerollCost}</span>
        </span>
      </button>

      <div class="modal-actions-inner flex gap-3 items-center">
        <button data-action="cancel" class="btn btn-secondary text-sm">Cancel</button>
        <button data-action="buy" class="btn btn-primary text-sm">Buy (${costNum}g)</button>
      </div>
    `;

            try {
                this.updateModalActionsRerollState(actions);
            } catch (e) {
            }
        } catch (e) {
        }
    }

    // attach drag handlers and return a cleanup function to remove them
    private attachDragHandlers(el: HTMLElement): (() => void) {
        if (!el) return (() => {
        });
        // Avoid attaching handlers multiple times to the same element. If another
        // instance already initialized the handlers, return a no-op cleanup.
        if ((el as any).__matchShopDragInit) return (() => {
        });
        (el as any).__matchShopDragInit = true;

        let pointerDown = false;
        let startX = 0;
        let scrollLeft = 0;
        let usingPointer = false;
        let suppressClickUntil = 0;

        // show grab cursor
        try {
            el.style.cursor = 'grab';
        } catch (e) {
        }

        const onPointerDown = (ev: PointerEvent) => {
            // only primary button start
            if (ev.button && ev.button !== 0) return;
            usingPointer = true;
            pointerDown = true;
            // Do not call setPointerCapture - it can interfere with native scrolling
            startX = ev.clientX;
            scrollLeft = el.scrollLeft;
            el.classList.add('dragging');
            try {
                el.style.cursor = 'grabbing';
            } catch (e) {
            }
        };

        const onPointerMove = (ev: PointerEvent) => {
            if (!pointerDown || !usingPointer) return;
            const dx = ev.clientX - startX;
            el.scrollLeft = scrollLeft - dx;
        };

        const onPointerUp = (ev: PointerEvent) => {
            if (!pointerDown || !usingPointer) return;
            pointerDown = false;
            el.classList.remove('dragging');
            try {
                el.style.cursor = 'grab';
            } catch (e) {
            }
            // snap to nearest
            try {
                const children = Array.from(el.children) as HTMLElement[];
                if (children.length > 0) {
                    const containerRect = el.getBoundingClientRect();
                    const containerCenter = containerRect.left + containerRect.width / 2;
                    let best: HTMLElement | null = null;
                    let bestDist = Infinity;
                    for (const c of children) {
                        const r = c.getBoundingClientRect();
                        const center = r.left + r.width / 2;
                        const dist = Math.abs(center - containerCenter);
                        if (dist < bestDist) {
                            bestDist = dist;
                            best = c;
                        }
                    }
                    if (best) try {
                        best.scrollIntoView({behavior: 'smooth', inline: 'center', block: 'nearest'});
                    } catch (e) {
                    }
                }
            } catch (e) {
            }
            // slight delay to allow pointer events to finish before clearing guard
            suppressClickUntil = Date.now() + 300; // suppress clicks for a short period
            setTimeout(() => {
                usingPointer = false;
            }, 50);
        };

        const onPointerCancel = (ev: PointerEvent) => {
            // Clean up state if pointer is cancelled (e.g. system gesture)
            try {
                pointerDown = false;
                usingPointer = false;
                el.classList.remove('dragging');
                try {
                    el.style.cursor = 'grab';
                } catch (e) {
                }
            } catch (e) {
            }
        };

        // Mouse fallback (for environments where pointer events might not be used or
        // to ensure explicit mouse dragging works). Guarded by `usingPointer` to
        let mouseDown = false;
        const onMouseDown = (ev: MouseEvent) => {
            if (usingPointer) return;
            if (ev.button !== 0) return;
            mouseDown = true;
            startX = ev.clientX;
            scrollLeft = el.scrollLeft;
            el.classList.add('dragging');
            try {
                el.style.cursor = 'grabbing';
            } catch (e) {
            }
            ev.preventDefault();
        };
        const onMouseMove = (ev: MouseEvent) => {
            if (!mouseDown) return;
            const dx = ev.clientX - startX;
            el.scrollLeft = scrollLeft - dx;
        };
        const onMouseUp = (ev: MouseEvent) => {
            if (!mouseDown) return;
            mouseDown = false;
            el.classList.remove('dragging');
            try {
                el.style.cursor = 'grab';
            } catch (e) {
            }
            try {
                const children = Array.from(el.children) as HTMLElement[];
                if (children.length > 0) {
                    const containerRect = el.getBoundingClientRect();
                    const containerCenter = containerRect.left + containerRect.width / 2;
                    let best: HTMLElement | null = null;
                    let bestDist = Infinity;
                    for (const c of children) {
                        const r = c.getBoundingClientRect();
                        const center = r.left + r.width / 2;
                        const dist = Math.abs(center - containerCenter);
                        if (dist < bestDist) {
                            bestDist = dist;
                            best = c;
                        }
                    }
                    if (best) try {
                        best.scrollIntoView({behavior: 'smooth', inline: 'center', block: 'nearest'});
                    } catch (e) {
                    }
                }
            } catch (e) {
            }
            suppressClickUntil = Date.now() + 300;
        };

        const onWheel = (ev: WheelEvent) => {
            try {
                if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
                    try {
                        el.scrollLeft = (el.scrollLeft || 0) + ev.deltaY;
                    } catch (e) {
                    }
                    ev.preventDefault();
                    suppressClickUntil = Date.now() + 200;
                }
            } catch (e) {
            }
        };

        const onClick = (ev: MouseEvent) => {
            try {
                if (Date.now() < suppressClickUntil) {
                    ev.preventDefault();
                    ev.stopPropagation();
                }
            } catch (e) {
            }
        };

        const onKeyDown = (ev: KeyboardEvent) => {
            if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
                const children = Array.from(el.querySelectorAll('.shop-card-modal-slide')) as HTMLElement[];
                if (!children || children.length === 0) return;
                const containerRect = el.getBoundingClientRect();
                const containerCenter = containerRect.left + containerRect.width / 2;
                let bestIndex = 0;
                let bestDist = Infinity;
                children.forEach((c, idx) => {
                    const r = c.getBoundingClientRect();
                    const center = r.left + r.width / 2;
                    const dist = Math.abs(center - containerCenter);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestIndex = idx;
                    }
                });
                let targetIndex = bestIndex + (ev.key === 'ArrowRight' ? 1 : -1);
                if (targetIndex < 0) targetIndex = 0;
                if (targetIndex >= children.length) targetIndex = children.length - 1;
                const target = children[targetIndex];
                if (target) {
                    try {
                        const container = el as HTMLElement;
                        const containerCenterW = container.clientWidth / 2;
                        const left = target.offsetLeft + (target.clientWidth / 2) - containerCenterW;
                        container.scrollTo({left, behavior: 'smooth'});
                    } catch (e) {
                    }
                }
                try {
                    ev.preventDefault();
                } catch (e) {
                }
            }
        };

        const supportsPointer = typeof window !== 'undefined' && ('PointerEvent' in window);
        if (supportsPointer) {
            el.addEventListener('pointerdown', onPointerDown as EventListener, {passive: false});
            el.addEventListener('pointermove', onPointerMove as EventListener, {passive: false});
            el.addEventListener('pointerup', onPointerUp as EventListener, {passive: false});
            el.addEventListener('pointercancel', onPointerCancel as EventListener, {passive: false});
            el.addEventListener('pointerleave', onPointerCancel as EventListener, {passive: false});
        } else {
            el.addEventListener('mousedown', onMouseDown as EventListener);
            el.addEventListener('mousemove', onMouseMove as EventListener);
            el.addEventListener('mouseup', onMouseUp as EventListener);
        }
        el.addEventListener('wheel', onWheel as EventListener, {passive: false});
        el.addEventListener('click', onClick as EventListener);
        el.addEventListener('keydown', onKeyDown as EventListener);

        return () => {
            try {
                if (supportsPointer) {
                    el.removeEventListener('pointerdown', onPointerDown as EventListener);
                    el.removeEventListener('pointermove', onPointerMove as EventListener);
                    el.removeEventListener('pointerup', onPointerUp as EventListener);
                    el.removeEventListener('pointercancel', onPointerCancel as EventListener);
                    el.removeEventListener('pointerleave', onPointerCancel as EventListener);
                } else {
                    el.removeEventListener('mousedown', onMouseDown as EventListener);
                    el.removeEventListener('mousemove', onMouseMove as EventListener);
                    el.removeEventListener('mouseup', onMouseUp as EventListener);
                }
                try {
                    (el as any).__matchShopDragInit = false;
                } catch (e) {
                }
            } catch (e) {
            }
            try {
                el.removeEventListener('wheel', onWheel as EventListener);
            } catch (e) {
            }
            try {
                el.removeEventListener('click', onClick as EventListener);
            } catch (e) {
            }
            try {
                el.removeEventListener('keydown', onKeyDown as EventListener);
            } catch (e) {
            }
        };
    }

    open() {
        try {
            this.openModal();
        } catch (e) {
        }
    }

    close() {
        try {
            this.closeModal();
        } catch (e) {
        }
    }
}

customElements.define("match-shop", MatchShop);

try {
    if (!(window as any).__matchShopGlobalOpenHandler) {
        document.addEventListener('click', (ev) => {
            try {
                const path = (ev as any).composedPath ? (ev as any).composedPath() : [ev.target];
                for (const p of path) {
                    if (!p || !(p instanceof Element)) continue;
                    if ((p as Element).matches && (p as Element).matches('[data-role="shop-open-mobile"]')) {
                        const btn = p as HTMLElement;
                        if (btn.hasAttribute('disabled')) return;
                        const shopEl = (btn.closest('match-shop') as any) || (document.querySelector('match-shop') as any);
                        if (shopEl && typeof shopEl.open === 'function') {
                            try {
                                shopEl.open();
                                ev.preventDefault();
                            } catch (e) {
                            }
                            return;
                        }
                    }
                }
            } catch (e) {
            }
        }, true);
        (window as any).__matchShopGlobalOpenHandler = true;
    }
} catch (e) {
}

