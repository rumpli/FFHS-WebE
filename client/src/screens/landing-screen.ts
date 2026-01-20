/**
 * landing-screen.ts
 *
 * Public landing page shown to unauthenticated users. Exposes quick navigation
 * events: `nav:play-guest`, `nav:login`, `nav:register`.
 */

customElements.define(
    "landing-screen",
    class extends HTMLElement {
        connectedCallback() {
            this.render();
        }

        private render() {
            this.innerHTML = `
<div id="landing-screen"
     class="vh-100 screens landing-screen">
  <img src="/assets/TowerlordsLogo.png" alt="TowerLords"
       class="max-h-[35dvh] w-auto h-auto mb-2 select-none"/>

  <div class="col-buttons-screen">
    <button id="btn-play-guest" type="button" class="btn btn-special">
      Play Now
    </button>
    <button id="btn-login" type="button" class="btn btn-primary">
      Login
    </button>
    <button id="btn-register" type="button" class="btn btn-secondary">
      Register
    </button>
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
            this.$("#btn-play-guest")?.addEventListener("click", () => {
                this.dispatchEvent(
                    new CustomEvent("nav:play-guest", {bubbles: true})
                );
            });

            this.$("#btn-login")?.addEventListener("click", () => {
                this.dispatchEvent(
                    new CustomEvent("nav:login", {bubbles: true})
                );
            });

            this.$("#btn-register")?.addEventListener("click", () => {
                this.dispatchEvent(
                    new CustomEvent("nav:register", {bubbles: true})
                );
            });
        }
    }
);
