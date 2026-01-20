/**
 * home-screen.ts
 *
 * The main home screen that provides navigation entry points: Play, Lobby,
 * Collection and other quick actions. Registered as `<home-screen>`.
 */

import "../ui/avatar-button";
import "../ui/shop-button";
import "../ui/logout-button";
import "../ui/collection-button";
import "../components/help-button";

customElements.define(
    "home-screen",
    class extends HTMLElement {
        connectedCallback() {
            this.render();
        }

        private render() {
            this.innerHTML = `
<div class="screens vh-100">

  <!-- Scaled center content -->
  <div class="home-center center-content">

    <img src="/assets/TowerlordsLogo.png" alt="TowerLords"
         class="max-h-[28dvh] w-auto h-auto mb-4 select-none"/>

    <div class="col-buttons-screen">
      <button id="btn-play" type="button" class="btn btn-primary w-full">
        Play
      </button>
      <button id="btn-lobby" type="button" class="btn w-full">
        Lobby
      </button>
      <tl-collection-button></tl-collection-button>
    </div>
  </div>

  <!-- HUD pinned to the *outer* container edges -->
  <tl-avatar-button></tl-avatar-button>
  <tl-shop-button></tl-shop-button>
  <div class="btn-bot-r flex items-center mr-10">
    <help-button></help-button>
    <tl-logout-button></tl-logout-button>
  </div>
  <app-footer></app-footer>
</div>
`;

            this.bind();
        }

        private $(sel: string) {
            return this.querySelector(sel) as HTMLElement | null;
        }

        private bind() {
            this.$("#btn-play")?.addEventListener("click", () => {
                this.dispatchEvent(new CustomEvent("nav:play", {bubbles: true}));
            });

            this.$("#btn-lobby")?.addEventListener("click", () => {
                this.dispatchEvent(new CustomEvent("nav:lobby", {bubbles: true}));
            });

            this.addEventListener("shop:click", () => {
                this.dispatchEvent(new CustomEvent("nav:shop", {bubbles: true}));
            });

            this.addEventListener("collection:click", () => {
                this.dispatchEvent(new CustomEvent("nav:collection", {bubbles: true}));
            });

            this.addEventListener("logout:click", () => {
                this.dispatchEvent(new CustomEvent("auth:logout", {bubbles: true}));
            });

        }
    }
);
