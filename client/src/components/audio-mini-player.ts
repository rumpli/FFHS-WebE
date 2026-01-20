/**
 * audio-mini-player.ts
 *
 * Small floating audio control used by the UI. Wraps the shared `audio` module
 * and exposes a compact UI for toggling playback, mute and volume.
 */

import {audio} from "../core/audio";

/**
 * `<audio-mini-player>` custom element
 * - Shows a toggle button that opens a small panel with controls
 * - Syncs UI to the shared audio state
 */
customElements.define("audio-mini-player", class extends HTMLElement {
    private root = this.attachShadow({mode: "open"});
    private open = false;

    // Handle clicks outside the component to close the panel
    private handleOutsideClick = (ev: PointerEvent) => {
        if (!this.open) return;
        if (ev.composedPath().includes(this)) return;
        this.open = false;
        this.updateOpenState();
    };

    disconnectedCallback() {
        document.removeEventListener("pointerdown", this.handleOutsideClick);
    }

    connectedCallback() {
        this.render();
        this.bind();
        this.updateFromAudio();
        document.addEventListener("pointerdown", this.handleOutsideClick);
    }

    private $(sel: string) {
        return this.root.querySelector(sel) as HTMLElement | null;
    }

    // Wire UI controls to the shared audio module
    private bind() {
        const toggle = this.$("#toggle") as HTMLButtonElement | null;
        const mute = this.$("#mute") as HTMLButtonElement | null;
        const vol = this.$("#vol") as HTMLInputElement | null;
        const next = this.$("#next") as HTMLButtonElement | null;
        const prev = this.$("#prev") as HTMLButtonElement | null;

        prev?.addEventListener("click", async () => {
            await audio.prev();
            this.updateFromAudio();
        });

        next?.addEventListener("click", async () => {
            await audio.next();
            this.updateFromAudio();
        });

        // Toggle open / start playback on first open
        toggle?.addEventListener("click", async () => {
            this.open = !this.open;
            this.updateOpenState();
            if (!audio.isStarted()) {
                await audio.play();
            }
        });

        mute?.addEventListener("click", () => {
            audio.toggleMute();
            this.updateFromAudio();
        });

        vol?.addEventListener("input", () => {
            const v = Number(vol.value) / 100;
            audio.setVolume(v);
            if (v === 0 && !audio.isMuted()) {
                audio.setMuted(true);
            } else if (v > 0 && audio.isMuted()) {
                audio.setMuted(false);
            }
            this.updateFromAudio();
        });
    }

    // Reflect open state in CSS and dispatch a composed event so other UI can react
    private updateOpenState() {
        const wrap = this.$(".wrap");
        if (!wrap) return;

        if (this.open) wrap.classList.add("open");
        else wrap.classList.remove("open");

        this.dispatchEvent(
            new CustomEvent("audio-panel", {
                detail: {open: this.open},
                bubbles: true,
                composed: true,
            })
        );
    }

    // Read shared audio state and update UI (icons, volume slider)
    private updateFromAudio() {
        const muted = audio.isMuted();
        const vol = audio.getVolume();

        const icon = this.$("#icon");
        const label = this.$("#label");
        const muteBtn = this.$("#mute");
        const volInput = this.$("#vol") as HTMLInputElement | null;

        if (volInput) {
            volInput.value = String(Math.round(vol * 100));
        }

        if (muteBtn) {
            muteBtn.textContent =
                muted || vol === 0 ? "🔇" : (vol < 0.4 ? "🔈" : vol < 0.8 ? "🔉" : "🔊");
        }

        if (icon) {
            if (muted || vol === 0) icon.textContent = "🔇";
            else if (vol < 0.4) icon.textContent = "🔈";
            else if (vol < 0.8) icon.textContent = "🔉";
            else icon.textContent = "🔊";
        }

        if (label) {
            label.textContent = muted || vol === 0 ? "Sound off" : "Background music";
        }
    }

    // Render shadow DOM UI
    private render() {
        this.root.innerHTML = `
      <style>
        :host {
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        #toggle {
          width: 2.3rem;
          height: 2.3rem;
          border-radius: 999px;
          border: 1px solid rgba(148,163,184,0.7);
          background: rgba(15,23,42,0.9);
          color: #e5e7eb;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 6px 16px rgba(15,23,42,0.35);
          backdrop-filter: blur(6px);
          transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
        }
        #toggle:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 20px rgba(15,23,42,0.45);
          border-color: rgba(96,165,250,0.8);
        }
        #icon {
          font-size: 1.1rem;
        }

        .panel {
          position: absolute;
          right: 0;
          bottom: 130%;
          min-width: 190px;
          padding: 0.5rem 0.75rem;
          border-radius: 0.75rem;
          border: 1px solid rgba(226,232,240,0.95);
          background: rgba(248,250,252,0.97);
          box-shadow: 0 10px 30px rgba(15,23,42,0.35);
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          transform: translateY(8px);
          opacity: 0;
          pointer-events: none;
          transition: transform 0.15s ease-out, opacity 0.15s ease-out;
          z-index: 10;
        }
        .wrap.open .panel {
          transform: translateY(0);
          opacity: 1;
          pointer-events: auto;
        }

        .row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.35rem;
        }

        #label {
          font-size: 0.70rem;
          color: #4b5563;
          text-align: left;
        }

        #mute {
          border: none;
          background: transparent;
          cursor: pointer;
          padding: 0;
          font-size: 0.85rem;
        }

        #vol {
          width: 100%;
        }
      </style>
      <div class="wrap">
        <button id="toggle" type="button" aria-label="Toggle audio panel">
          <span id="icon">🔊</span>
        </button>

        <div class="panel">
          <div class="row">
          <div id="label">Background music</div>
          <div class="row" style="gap:.35rem">
            <button id="prev" type="button" aria-label="Previous">⏮</button>
            <button id="mute" type="button" aria-label="Mute or unmute">🔊</button>
            <button id="next" type="button" aria-label="Next">⏭</button>
          </div>
          </div>
          <input id="vol" type="range" min="0" max="100" step="5" />
        </div>
      </div>
    `;
    }
});
