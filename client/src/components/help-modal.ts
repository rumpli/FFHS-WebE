/**
 * help-modal.ts
 *
 * Modal containing a short quick manual. Focus-traps the inner content and
 * closes on Escape or clicking the overlay.
 */

customElements.define("help-modal", class extends HTMLElement {
    connectedCallback() {
        this.className = "fixed inset-0 z-60 flex items-center justify-center bg-black/50";

        this.innerHTML = `
  <div class="help-modal-inner relative bg-white rounded-2xl shadow-2xl border border-gray-200 w-[90vw] max-w-2xl max-h-[80vh] overflow-auto p-6" tabindex="-1">
    <button class="help-close-btn absolute top-3 right-3 text-gray-600 bg-white rounded-full p-1 shadow" aria-label="Close">×</button>
    <h2 class="text-lg font-bold mb-2">Towerlords — Quick Manual</h2>
    <p class="text-sm text-gray-700 mb-4">A short guide to get you playing quickly. Close this overlay with the × button or Escape.</p>

    <section class="mb-4">
      <h3 class="font-semibold">Overview</h3>
      <p class="text-sm text-gray-700">Towerlords is a head-to-head tower defense card game. Build a board of units, buy from the shop, upgrade your tower and outlast your opponent.</p>
    </section>

    <section class="mb-4">
      <h3 class="font-semibold">Match Flow</h3>
      <ul class="text-sm text-gray-700 list-disc ml-4">
        <li>Each round you get gold to buy cards from the shop.</li>
        <li>Play cards from your hand onto board slots to form your defense/offense.</li>
        <li>At round end, both boards fight. Units damage the tower until they are killed.</li>
      </ul>
    </section>

    <section class="mb-4">
      <h3 class="font-semibold">Controls</h3>
      <ul class="text-sm text-gray-700 list-disc ml-4">
        <li>Click a card in the shop to open details and actions (like buy/sell/play).</li>
        <li>Drag a card from your hand to a board slot to play it.</li>
        <li>Drag a board card onto the shop area to sell it.</li>
        <li>Use the Chat button to open in-match chat.</li>
      </ul>
    </section>

    <section class="mb-4">
      <h3 class="font-semibold">Cards & Abilities</h3>
      <p class="text-sm text-gray-700">Cards have types like damage, buff or economy. Open a card to view its stats and description.</p>
      <p class="text-sm text-gray-700">Cards are played and placed onto the board (attack and defense cards mostly) and stay there. Buff and economy cards in most cases are directly applied and do not occupy a board slot.</p>
      <p class="text-sm text-gray-700">All cards that are placed on a board slot or apply effects go into the "Discarded" deck. The discarded deck gets reshuffled into the deck when the last card is drawn from the deck.</p>
    </section>

    <section class="mb-4">
      <h3 class="font-semibold">Shop & Gold</h3>
      <p class="text-sm text-gray-700">You earn gold each round. Buy cards from the shop — pay gold to refresh cards with a reroll. Cards bought go directly into your deck. Upgrading your tower helps survive longer.</p>
    </section>
    
    <section class="mb-4">
      <h3 class="font-semibold">Tower upgrade</h3>
      <p class="text-sm text-gray-700">Upgrading your tower gives you instant more Tower HP and more Tower DPS (T-DPS). With each upgrade (until lvl. 5) the shop offers one more card and increases your chances to buy even rarer cards.</p>
    </section>

    <section class="mb-4">
      <h3 class="font-semibold">Tips</h3>
      <ul class="text-sm text-gray-700 list-disc ml-4">
        <li>Combine identical units to increase stack count and power.</li>
        <li>Economy cards can help snowball your gold over rounds.</li>
      </ul>
    </section>
  </div>
`;

        this.bind();
        setTimeout(() => {
            (this.querySelector('.help-modal-inner') as HTMLElement | null)?.focus();
        }, 0);
    }

    disconnectedCallback() {
        try {
            document.removeEventListener('keydown', this.onKeyDown);
        } catch (e) {
        }
    }

    private onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') this.remove();
    }

    private bind() {
        try {
            const closeBtn = this.querySelector('.help-close-btn') as HTMLElement | null;
            closeBtn?.addEventListener('click', () => this.remove());
            document.addEventListener('keydown', this.onKeyDown);
            this.addEventListener('click', (ev) => {
                if (ev.target === this) this.remove();
            });
        } catch (e) {
        }
    }
});
