/**
 * end-match-modal.ts
 *
 * Modal presented at match end. Shows win/lose message and optional reason
 * attributes. Emits `modal:confirm` when dismissed.
 */

import {mapEliminationReason, isMarryReason} from "../core/reason-utils";

class EndMatchModal extends HTMLElement {
    private shadow: ShadowRoot;

    constructor() {
        super();
        this.shadow = this.attachShadow({mode: 'open'});
    }

    connectedCallback() {
        const win = this.hasAttribute('win') && this.getAttribute('win') !== 'false';
        const title = win ? 'You won' : 'You lost';

        const explicit = this.getAttribute('subtitle') ?? undefined;

        const selfReason = this.getAttribute('elimination-reason') ?? undefined;
        const oppReason = this.getAttribute('opponent-elimination-reason') ?? undefined;

        const selfHadMarryRefusal = isMarryReason(undefined, selfReason);
        const oppHadMarryRefusal = isMarryReason(undefined, oppReason);
        const anyMarryRefusal = selfHadMarryRefusal || oppHadMarryRefusal;

        let subtitlePrimary: string | undefined = explicit ?? undefined;
        let subtitleSecondary: string | undefined = undefined;

        if (!subtitlePrimary) {
            const selfText = mapEliminationReason(selfReason, false);
            const oppText = mapEliminationReason(oppReason, true);

            if (anyMarryRefusal) {
                subtitlePrimary = win ? mapEliminationReason('marry_refusal', true) : mapEliminationReason('marry_refusal', false);
                const otherText = win ? selfText : oppText;
                if (otherText && otherText !== subtitlePrimary) subtitleSecondary = win ? `You: ${otherText}` : `Opponent: ${otherText}`;
            } else {
                if (win) {
                    subtitlePrimary = oppText ?? selfText ?? 'Congratulations on your victory!';
                    if (selfText && selfText !== subtitlePrimary) subtitleSecondary = `You: ${selfText}`;
                } else {
                    subtitlePrimary = selfText ?? oppText ?? 'Better luck next time!';
                    if (oppText && oppText !== subtitlePrimary) subtitleSecondary = `Opponent: ${oppText}`;
                }
            }
        }

        subtitlePrimary = subtitlePrimary ?? (win ? 'Congratulations on your victory!' : 'Better luck next time!');

        const ring = anyMarryRefusal ? ' 💍' : '';

        // Render: show primary subtitle, and an optional secondary line when we have more detail
        this.shadow.innerHTML = `
      <style>
        :host { position: fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center; }
        .overlay { position: absolute; inset:0; background: rgba(0,0,0,0.7); backdrop-filter: blur(6px); }
        .card { position: relative; z-index: 2; background: linear-gradient(180deg, #0b0b0b, #1e1e1e); color: #fff; padding: 32px 28px; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); text-align:center; max-width: 90%; width: 680px; }
        h1 { font-size: 48px; margin: 0 0 8px; letter-spacing: -1px; }
        p { margin: 0; opacity: 0.95; }
        .secondary { margin-top: 6px; font-size: 14px; opacity: 0.85; color: #ddd }
        .cta { margin-top: 18px; font-size: 14px; opacity: 0.9 }
        .card:active { transform: scale(0.995); }
      </style>
      <div class="overlay"></div>
      <div class="card" role="dialog" aria-modal="true" aria-label="Match result">
        <h1>${title}${ring}</h1>
        <p>${subtitlePrimary}</p>
        ${subtitleSecondary ? `<div class="secondary">${subtitleSecondary}</div>` : ''}
        <div class="cta">Click anywhere to continue</div>
      </div>
    `;

        // Close on any click or keypress
        const onClick = () => this._confirm();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') this._confirm();
        };
        this.shadow.querySelector('.overlay')?.addEventListener('click', onClick);
        this.shadow.querySelector('.card')?.addEventListener('click', onClick);
        window.addEventListener('keydown', onKey);
        (this as any)._endModalCleanup = () => {
            try {
                this.shadow.querySelector('.overlay')?.removeEventListener('click', onClick);
            } catch (e) {
            }
            try {
                this.shadow.querySelector('.card')?.removeEventListener('click', onClick);
            } catch (e) {
            }
            try {
                window.removeEventListener('keydown', onKey);
            } catch (e) {
            }
        };
    }

    disconnectedCallback() {
        try {
            (this as any)._endModalCleanup?.();
        } catch (e) {
        }
    }

    private _confirm() {
        try {
            this.dispatchEvent(new CustomEvent('modal:confirm', {bubbles: true, composed: true}));
        } catch (e) {
        }
        try {
            this.remove();
        } catch (e) {
        }
    }
}

customElements.define('end-match-modal', EndMatchModal);

export {};
