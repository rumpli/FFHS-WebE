/**
 * login-form.ts
 *
 * Login screen form. Submits username/password to the API and stores returned
 * token using the auth helper. Emits `login:success` on successful login.
 */

import {setToken} from "../auth/auth.js";

customElements.define("login-form", class extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
<div class="vh-100 screens landing-screen">
  <form id="form"
        class="form form-compact w-[min(420px,92vw)] text-left"
        novalidate>

    <h2 class="form-row text-xl font-semibold text-center">Login</h2>

    <div class="field form-row">
      <div class="field-inner">
          <input id="username" name="username" class="field-input" placeholder=" " required />
          <label for="username" class="field-label">Username</label>
      </div> 
    </div>

    <div class="field form-row">
      <div class="field-inner">
          <input id="password" name="password" type="password" class="field-input" placeholder=" " required />
          <label for="password" class="field-label">Password</label>
      </div> 
      <div id="msg" class="hint"></div>
    </div>

    <div class="button-wrapper form-row">
      <button type="button" id="back" class="btn btn-secondary">Back</button>
      <button type="submit" id="submit" class="btn btn-primary">Login</button>
    </div>

    <!-- separator -->
    <div class="flex items-center gap-3 pt-6 text-xs text-gray-500 pb-2">
      <div class="flex-1 h-px bg-gray-200"></div>
      <span class="whitespace-nowrap">Other login options</span>
      <div class="flex-1 h-px bg-gray-200"></div>
    </div>
    
    <!-- OAuth / Web3 buttons -->
    <div class="form-row button-wrapper flex flex-col gap-3">
    
      <!-- Web3 Login -->
      <button type="button" id="btn-web3"
        class="btn-form btn flex items-center justify-center gap-2 w-full border border-emerald-600 text-emerald-700 hover:bg-emerald-50">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2l4 8-4 4-4-4 4-8z"></path>
          <circle cx="12" cy="18" r="4"></circle>
        </svg>
        Web3 Login
      </button>
    
      <!-- GitHub Login -->
      <button type="button" id="btn-github"
        class="btn-form btn flex items-center justify-center gap-2 w-full bg-gray-900 text-white hover:bg-gray-800">
        <svg aria-hidden="true" viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
          <path fill-rule="evenodd"
                d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38
                0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52
                0-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
                0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.56 7.56 0 018 3.75c.68.003
                1.36.092 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15
                0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.19
                0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z">
          </path>
        </svg>
        Login with GitHub
      </button>
    </div>
  </form>
        <app-footer></app-footer>
</div>
`;
        this.bind();
    }

    private $(sel: string) {
        return this.querySelector(sel) as HTMLElement | null;
    }

    private notImplemented() {
        const modal = document.createElement("not-implemented-modal");
        document.body.appendChild(modal);
    }

    private bind() {
        const form = this.$("#form") as HTMLFormElement;
        const msg = this.$("#msg")!;
        const submitBtn = this.$("#submit") as HTMLButtonElement;

        this.$("#back")!.addEventListener("click", () => {
            this.dispatchEvent(new CustomEvent("nav:back", {bubbles: true}));
        });

        this.$("#btn-web3")!.addEventListener("click", () => {
            this.dispatchEvent(new CustomEvent("login:web3", {bubbles: true}));
            this.notImplemented();
        });

        this.$("#btn-github")!.addEventListener("click", () => {
            this.dispatchEvent(new CustomEvent("login:github", {bubbles: true}));
            this.notImplemented();
        });

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            msg.textContent = "";
            submitBtn.disabled = true;
            submitBtn.classList.add("opacity-60", "cursor-not-allowed");

            const username = (this.$("#username") as HTMLInputElement).value.trim();
            const password = (this.$("#password") as HTMLInputElement).value;

            try {
                const API = (window as any).__CFG__.API_URL;
                const url = `${API}/login`;
                const res = await fetch(url, {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({usernameOrEmail: username, password}),
                });

                const data = await res.json().catch(() => null);

                if (res.ok && data?.ok) {
                    if (!data.token) {
                        const serverMsg = "Login failed.";
                        console.error(serverMsg);
                        msg.textContent = serverMsg;
                        msg.className = "text-sm text-red-600 mt-1 mb-1";
                        return;
                    }
                    setToken(data.token);

                    msg.textContent = "Logged in successfully.";
                    msg.className = "text-sm text-green-700 mt-1 mb-1";

                    setTimeout(() => {
                        this.dispatchEvent(new CustomEvent("login:success", {
                            detail: {user: data.user ?? {username}, token: data.token},
                            bubbles: true
                        }));
                    }, 400);

                    return;
                }

                if (data?.error === "VALIDATION_ERROR") {
                    msg.textContent = "Invalid credentials.";
                    msg.className = "text-sm text-red-600 mt-1 mb-1";
                    return;
                }

                if (data?.error === "INVALID_CREDENTIALS") {
                    msg.textContent = "Invalid credentials.";
                    msg.className = "text-sm text-red-600 mt-1 mb-1";
                    return;
                }

                msg.textContent = "Unable to login. Please try again.";
                msg.className = "text-sm text-red-600 mt-1 mb-1";

            } catch (err: any) {
                msg.textContent = err?.message || "Login failed.";
                msg.className = "text-sm text-red-600 mt-1 mb-1";
            } finally {
                submitBtn.disabled = false;
                submitBtn.classList.remove("opacity-60", "cursor-not-allowed");
            }
        });
    }
});
