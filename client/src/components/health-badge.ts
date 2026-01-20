/**
 * health-badge.ts
 *
 * Small system health indicator that polls an HTTP health endpoint and
 * shows a status/popup dialog. Useful for debugging and operator visibility.
 */


import {state} from "../core/store";
import {getWsState, ensureConnected} from "../core/ws";

const HEALTH_URL = (window as any).__CFG__.HEALTH_URL;

customElements.define("health-badge", class extends HTMLElement {
    private intervalMs = 10_000;
    private poll?: number;
    private rafId?: number;
    private busy = false;
    private lastTs: number | null = null;
    private nextTs: number | null = null;

    connectedCallback() {
        this.render();
        this.bind();
        this.tick();
        this.poll = window.setInterval(() => this.tick(), this.intervalMs);
        this.rafId = requestAnimationFrame(this.updateCountdown);
    }

    disconnectedCallback() {
        if (this.poll) clearInterval(this.poll);
        if (this.rafId) cancelAnimationFrame(this.rafId);
    }

    private $(sel: string) {
        return this.querySelector(sel) as HTMLElement | null;
    }

    private fmt(ts: number | null) {
        return ts ? new Date(ts).toLocaleString() : "–";
    }

    private left(ts: number | null) {
        if (!ts) return "–";
        const s = Math.max(0, Math.ceil((ts - Date.now()) / 1000));
        return `${s}s`;
    }

    private setBusy(b: boolean) {
        this.busy = b;
        this.$("#spin-health")?.classList.toggle("hidden", !b);
        const re = this.$("#dlg-recheck") as HTMLButtonElement | null;
        if (re) re.disabled = b;
    }

    private setButton(ok: boolean) {
        const b = this.$("#btn-health");
        if (!b) return;
        b.classList.remove("border-green-400", "border-red-400");
        b.classList.add(ok ? "border-green-400" : "border-red-400");
    }

    private async tick() {
        if (this.busy) return;
        this.setBusy(true);
        try {
            ensureConnected();

            const r = await fetch(HEALTH_URL, {cache: "no-store"});
            const server = await r.json();

            const wsState = getWsState();
            const merged = {server, ws: {state: wsState}};
            state.health = merged;

            const allOk = Boolean(server?.ok) && wsState === "connected";
            this.setButton(allOk);
            this.setDot(allOk);

            if ((this.$("#dlg") as HTMLDialogElement).open) this.fillDialog(merged);
        } catch (e: any) {
            const wsState = getWsState();
            const merged = {
                server: {ok: false, error: e?.message ?? String(e)},
                ws: {state: wsState},
            };
            state.health = merged;
            this.setButton(false);
            this.setDot(false);

            if ((this.$("#dlg") as HTMLDialogElement).open) this.fillDialog(merged);
        } finally {
            this.lastTs = Date.now();
            this.nextTs = this.lastTs + this.intervalMs;
            this.setBusy(false);
        }
    }

    private setPill(el: HTMLElement | null, ok: boolean) {
        if (!el) return;
        el.classList.remove("pill-ok", "pill-bad");
        el.classList.add(ok ? "pill-ok" : "pill-bad");
    }

    private setDot(ok: boolean) {
        const dot = this.$("#dot");
        if (!dot) return;
        dot.className = ok
            ? "inline-block size-[0.75em] rounded-full bg-green-500 align-middle"
            : "inline-block size-[0.75em] rounded-full bg-red-500 align-middle";
    }

    private fillDialog(payload: any) {
        const serverOk = Boolean(payload?.server?.ok);
        const wsConnected = payload?.ws?.state === "connected";

        this.$("#dlg-health-summary")!.textContent = serverOk ? "healthy" : "unhealthy";
        this.$("#dlg-ws-summary")!.textContent = `${payload?.ws?.state ?? "unknown"}`;
        this.$("#dlg-health-last")!.textContent = this.fmt(this.lastTs);
        this.$("#dlg-health-next")!.textContent = this.left(this.nextTs);
        this.$("#dlg-body")!.textContent = JSON.stringify(payload ?? {}, null, 2);

        this.setPill(this.$("#pill-server"), serverOk);
        this.setPill(this.$("#pill-ws"), wsConnected);

        const ok = serverOk && wsConnected;
        this.setDot(ok);
        this.setButton(ok);
    }

    private updateCountdown = () => {
        if ((this.$("#dlg") as HTMLDialogElement)?.open) {
            this.$("#dlg-health-next")?.replaceChildren(document.createTextNode(this.left(this.nextTs)));
        }
        this.rafId = requestAnimationFrame(this.updateCountdown);
    };

    private bind() {
        this.$("#btn-health")!.addEventListener("click", () => {
            const dlg = this.$("#dlg") as HTMLDialogElement;
            if (!dlg.open) dlg.showModal();
            this.fillDialog(state.health ?? {});
        });
        this.$("#dlg-close")!.addEventListener("click", () => (this.$("#dlg") as HTMLDialogElement).close());
        this.$("#dlg-recheck")!.addEventListener("click", () => this.tick());
    }

    private render() {
        this.innerHTML = `
<div class="relative text-[1em]">
  <button id="btn-health"
    class="flex items-center justify-center size-[2.4em] leading-none
           rounded-full border transition-colors bg-white shadow
           hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-400
           border-gray-200"
    title="Backend & WebSocket health">
    <span id="dot" class="inline-block size-[0.75em] rounded-full bg-gray-400"></span>
  </button>

  <div id="spin-health"
       class="absolute -top-[0.25em] -left-[0.25em] size-[1em]
              border-[0.15em] border-gray-300 border-t-gray-600
              rounded-full animate-spin hidden"></div>
</div>

<dialog id="dlg" class="rounded-2xl p-0">
  <div class="card">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-lg font-semibold">System Status</h2>
      
      <button id="dlg-close" class="btn text-sm">Close</button>
    </div>

    <div class="mb-4">
      <div class="flex items-center gap-3 mb-2 text-sm">
        <span id="pill-server" class="pill">Server</span>
        <span id="dlg-health-summary" class="text-gray-700">checking…</span>
      </div>
      <div class="flex items-center gap-3 mb-2 text-sm">
        <span id="pill-ws" class="pill">WebSocket</span>
        <span id="dlg-ws-summary" class="text-gray-700">disconnected</span>
      </div>
      <pre id="dlg-body" class="mono bg-gray-50 border border-gray-100 rounded-md p-2 max-h-[50vh] overflow-auto">–</pre>
    </div>

    <div>

        <span class="text-gray-600">last: <span id="dlg-health-last">–</span></span>
        <span class="text-gray-600">next in <span id="dlg-health-next">–</span></span>
        <button id="dlg-recheck" class="btn text-sm">Recheck</button>
    </div>
  </div>
</dialog>
`;
    }
});

