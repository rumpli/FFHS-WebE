/**
 * register-form.ts
 *
 * User registration form. Submits username/email/password to backend and,
 * on success, stores token and emits `login:success` for the app to react.
 */

import {setToken} from "../auth/auth.js";

customElements.define("register-form", class extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
<div class="vh-100 screens landing-screen">
  <form id="form"
        class="form form-compact w-[min(420px,92vw)] text-left"
        novalidate>
    <h2 class="form-row text-lg font-semibold text-center">Create account</h2>

    <div class="field form-row">
      <div class="field-inner">
          <input id="username" name="username" class="field-input" placeholder=" " autocomplete="username" required />
          <label for="username" class="field-label">Username</label>
        </div> 
      <div id=hint-username class="hint"></div>
    </div>

    <div class="field form-row">
      <div class="field-inner">
          <input id="email" name="email" type="email" class="field-input" placeholder=" " autocomplete="email" inputmode="email" required />
          <label for="email" class="field-label">Email</label>
        </div>
      <div id=hint-email class="hint"></div>
    </div>

    <div class="field form-row">
      <div class="field-inner">
        <input id="pw" name="password" type="password"
               class="field-input" placeholder=" " required minlength="8" />
        <label for="pw" class="field-label">Password</label>
      </div>
    
      <div id=hint-pw class="hint">Min. 12 chars. Use letters and numbers.</div>
    </div>

    <div class="field form-row">
      <div class="field-inner">
          <input id="pw2" name="password_confirm" type="password" class="field-input" placeholder=" " autocomplete="new-password" minlength="8" required />
          <label for="pw2" class="field-label">Confirm password</label>
        </div>
      <div id=hint-pw2 class="hint"> </div>
    </div>

    <div id="msg" class="text-sm mt-1 form-row"></div>

    <div class="button-wrapper form-row">
      <button type="button" id="back" class="btn btn-secondary">Back</button>
      <button type="submit" id="submit" class="btn btn-primary">Create</button>
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

    private setHint(id: string, text: string, type: "error" | "success" | "info" | null = null) {
        const el = this.$(`#hint-${id}`);
        if (!el) return;
        el.textContent = text;
        el.className = "hint" + (type === "error" ? " error" : type === "success" ? " success" : "");
    }

    private clearAllHints() {
        this.setHint("username", "");
        this.setHint("email", "");
        // password default hint we keep as info
        this.setHint("pw", "Min. 12 chars. Use letters and numbers.", "info");
        this.setHint("pw2", "");
    }

    private bind() {
        const form = this.$("#form") as HTMLFormElement;
        const msg = this.$("#msg")!;
        const submitBtn = this.$("#submit") as HTMLButtonElement;

        this.$("#back")!.addEventListener("click", () => {
            this.dispatchEvent(new CustomEvent("nav:back", {bubbles: true}));
        });

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            msg.textContent = "";
            msg.className = "text-sm mt-2";
            this.clearAllHints();

            submitBtn.disabled = true;
            submitBtn.classList.add("opacity-60", "cursor-not-allowed");

            const username = (this.$("#username") as HTMLInputElement).value.trim();
            const email = (this.$("#email") as HTMLInputElement).value.trim();
            const pw = (this.$("#pw") as HTMLInputElement).value;
            const pw2 = (this.$("#pw2") as HTMLInputElement).value;

            if (pw !== pw2) {
                this.setHint("pw2", "Passwords do not match.", "error");
                submitBtn.disabled = false;
                submitBtn.classList.remove("opacity-60", "cursor-not-allowed");
                return;
            }

            try {
                const API = (window as any).__CFG__.API_URL;
                const url = `${API}/register`;
                const res = await fetch(url, {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({username, email, password: pw})
                });

                const data = await res.json().catch(() => null);

                if (res.ok && data?.ok && data.token) {
                    setToken(data.token);

                    msg.textContent = "Account created successfully.";
                    msg.className = "text-sm text-green-700 mt-1";

                    setTimeout(() => {
                        this.dispatchEvent(new CustomEvent("login:success", {
                            detail: {user: data.user, token: data.token},
                            bubbles: true,
                        }));
                    }, 500);
                    return;
                }

                if (data?.error === "USERNAME_OR_EMAIL_TAKEN") {

                    this.setHint("username", "Username or email is already in use.", "error");
                    this.setHint("email", "Username or email is already in use.", "error");
                    return;
                }

                if (data?.error === "VALIDATION_ERROR" && Array.isArray(data.issues)) {
                    for (const issue of data.issues) {
                        const field = issue.path?.[0] as string | undefined;
                        const message = issue.message as string;

                        if (field === "username") {
                            this.setHint("username", message, "error");
                        } else if (field === "email") {
                            this.setHint("email", message, "error");
                        } else if (field === "password") {
                            this.setHint("pw", message, "error");
                        } else {
                            msg.textContent = message;
                            msg.className = "text-sm text-red-600 mt-2";
                        }
                    }
                    return;
                }
                msg.textContent = data?.msg || data?.error || `Registration failed (HTTP ${res.status})`;
                msg.className = "text-sm text-red-600 mt-2";
                return;
            } catch (err: any) {
                msg.textContent = err?.message ?? "Registration failed.";
                msg.className = "text-sm text-red-600 mt-2";
            } finally {
                submitBtn.disabled = false;
                submitBtn.classList.remove("opacity-60", "cursor-not-allowed");
            }
        });
    }
});
