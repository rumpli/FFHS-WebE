/**
 * audio.ts
 *
 * Small audio manager that controls background music playlist, volume and
 * mute state. Persists user settings in localStorage and exposes a singleton
 * `audio` instance for UI to call (play/next/prev/setVolume/toggleMute).
 */

type AudioSettings = {
    muted: boolean;
    volume: number;
    index: number;
};

const KEY = "towerlords:audio";

function clamp01(v: number) {
    return Math.min(1, Math.max(0, v));
}

function loadSettings(): AudioSettings {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return {muted: false, volume: 0.2, index: 0};
        const j = JSON.parse(raw);
        return {
            muted: Boolean(j.muted),
            volume: clamp01(Number(j.volume ?? 0.2)),
            index: Number.isFinite(j.index) ? Number(j.index) : 0,
        };
    } catch {
        return {muted: false, volume: 0.2, index: 0};
    }
}

function saveSettings(s: AudioSettings) {
    try {
        localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
    }
}

/**
 * Manages a small playlist of HTMLAudioElement instances.
 * - Persists muted/volume/index in localStorage
 * - Automatically advances to next track on 'ended'
 * - Provides helpers to hook first user gesture so autoplay works on mobile
 */
class AudioManager {
    private readonly playlist: HTMLAudioElement[] = [];
    private index = 0;
    private current: HTMLAudioElement | null = null;
    private muted = false;
    private volume = 0.2;
    private started = false;

    constructor() {
        const settings = loadSettings();
        this.muted = settings.muted;
        this.volume = settings.volume;
        this.index = settings.index;

        const tracks = [
            new Audio("/audio/theme-the-deck-soft.mp3"),
            new Audio("/audio/theme-the-deck-hard.mp3"),
            new Audio("/audio/fear-the-light.mp3"),
        ];

        for (const a of tracks) {
            a.loop = false;
            a.volume = this.volume;
            a.muted = this.muted;
            a.preload = "auto";
        }

        this.playlist = tracks;
        if (this.index < 0 || this.index >= this.playlist.length) this.index = 0;
        for (const t of this.playlist) {
            t.addEventListener("ended", () => this.next());
        }
        this.persist();
    }

    private persist() {
        saveSettings({muted: this.muted, volume: this.volume, index: this.index});
    }

    private applyTo(el: HTMLAudioElement) {
        el.volume = this.volume;
        el.muted = this.muted;
    }

    private async playCurrentFromStart() {
        if (this.playlist.length === 0) return;
        const track = this.playlist[this.index];
        this.current = track;
        track.currentTime = 0;
        this.applyTo(track);
        this.started = true;
        this.persist();
        try {
            await track.play();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Start playback of the current track (or resume if paused).
     * Returns true when playback succeeded (or false when blocked by browser).
     */
    async play() {
        if (!this.current) {
            return this.playCurrentFromStart();
        }
        this.applyTo(this.current);
        this.started = true;
        this.persist();
        try {
            await this.current.play();
            return true;
        } catch {
            return false;
        }
    }

    /** Advance to the next track and start playback */
    async next() {
        if (this.playlist.length === 0) return false;
        if (this.current) {
            try {
                this.current.pause();
            } catch {
            }
        }
        this.index = (this.index + 1) % this.playlist.length;
        this.persist();
        return this.playCurrentFromStart();
    }

    /** Go to previous track and start playback */
    async prev() {
        if (this.playlist.length === 0) return false;
        if (this.current) {
            try {
                this.current.pause();
            } catch {
            }
        }
        this.index = (this.index - 1 + this.playlist.length) % this.playlist.length;
        this.persist();
        return this.playCurrentFromStart();
    }

    /**
     * Hook the first user gesture so autoplay can be attempted on mobile.
     * This installs one-time listeners for pointerdown/keydown.
     */
    hookFirstGesture() {
        if (this.started) return;
        const handler = () => {
            void this.play();
            window.removeEventListener("pointerdown", handler);
            window.removeEventListener("keydown", handler);
        };
        window.addEventListener("pointerdown", handler, {once: true});
        window.addEventListener("keydown", handler, {once: true});
    }

    setMuted(m: boolean) {
        this.muted = m;
        if (this.current) this.current.muted = m;
        this.persist();
    }

    toggleMute() {
        this.setMuted(!this.muted);
    }

    isMuted() {
        return this.muted;
    }

    setVolume(v: number) {
        this.volume = clamp01(v);
        if (this.current) this.current.volume = this.volume;
        this.persist();
    }

    getVolume() {
        return this.volume;
    }

    getIndex() {
        return this.index;
    }

    getTrackCount() {
        return this.playlist.length;
    }

    isStarted() {
        return this.started;
    }
}

/** Shared singleton used by UI code */
export const audio = new AudioManager();
