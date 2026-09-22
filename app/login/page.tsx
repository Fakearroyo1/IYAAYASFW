"use client";
import {secureFetch} from "@/lib/identity/client";
import { BrandMark, ThemeToggle } from "@/app/store/appearance";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export default function Login() {
  const widget = useRef<HTMLDivElement>(null),
    widgetId = useRef<string | null>(null);
  const [challengeToken, setChallengeToken] = useState(""),
    [setupCode, setSetupCode] = useState("");
  const [methods,setMethods]=useState<Record<string,boolean>|null>(null);
  useEffect(()=>{void fetch('/identity/api',{cache:'no-store'}).then(r=>r.json() as Promise<{enabled:boolean;methods:Record<string,boolean>}>).then(c=>{if(c.enabled)setMethods(c.methods);}).catch(()=>{});},[]);
  useEffect(() => {
    let disposed = false;
    secureFetch("/api/auth")
      .then((r) => r.json())
      .then((config: any) => {
        if (!config.siteKey)
          throw Error("Sign-in protection is not configured.");
        const render = () => {
          if (disposed || !widget.current) return;
          widgetId.current = (window as any).turnstile.render(widget.current, {
            sitekey: config.siteKey,
            action: "account",
            size: "flexible",
            callback: setChallengeToken,
            "expired-callback": () => setChallengeToken(""),
            "error-callback": () => {
              setChallengeToken("");
              setError(
                "The security check could not load. Refresh and try again.",
              );
            },
          });
        };
        if ((window as any).turnstile) render();
        else {
          const script = document.createElement("script");
          script.src =
            "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
          script.async = true;
          script.onload = render;
          script.onerror = () =>
            setError(
              "The security check could not load. Refresh and try again.",
            );
          document.head.appendChild(script);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      disposed = true;
      if (widgetId.current) (window as any).turnstile?.remove(widgetId.current);
    };
  }, []);
  const [mode, setMode] = useState("login"),
    [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  function change(next: string) {
    setMode(next);
    setError("");
    setMessage("");
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (
        ["setup", "recovery"].includes(mode) &&
        f.get("password") !== f.get("confirm")
      )
        throw Error("The new passwords do not match.");
      const action = (
        {
          login: "login",
          first: "firstTime",
          setup: "completeSetup",
          forgot: "requestReset",
          recovery: "completeRecovery",
        } as Record<string, string>
      )[mode];
      const r = await secureFetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          email,
          password: f.get("password"),
          code: mode === "setup" ? setupCode : f.get("code"),
          challengeToken,
        }),
      });
      const result = (await r.json()) as { error?: string; message?: string };
      if (!r.ok) throw Error(result.error || "Please try again.");
      if (mode === "first") {
        setSetupCode(String(f.get("code") || ""));
        setMode("setup");
        return;
      }
      if (mode === "forgot") {
        setMessage(
          result.message || "Your request has been sent to the administrators.",
        );
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.replace(
        next && /^\/products\/[a-zA-Z0-9_-]+$/.test(next) ? next : "/",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Try again.");
    } finally {
      setBusy(false);
      setChallengeToken("");
      if (widgetId.current) (window as any).turnstile?.reset(widgetId.current);
    }
  }
  return (
    <main className="login-shell">
      <section className="panel login-card">
        <div className="login-brand">
          <div className="brand">
            <BrandMark />
            <span>
              IYAAYASFW<span className="brand-sub">Unit Supply</span>
            </span>
          </div>
          <ThemeToggle />
        </div>
        <h1>
          {mode === "login"
            ? methods ? "Use existing password" : "Member sign-in"
            : mode === "forgot"
              ? "Reset your password"
              : ["setup", "recovery"].includes(mode)
                ? "Choose your password"
                : "First time here?"}
        </h1>
        <p>
          {mode === "login"
            ? "Sign in with your approved email and password."
            : mode === "first"
              ? "Enter your approved email and the private setup code from your administrator."
              : mode === "recovery"
                ? "Choose a password only you know. Recovery codes expire after one hour and can be used once."
                : mode === "setup"
                  ? "Choose a password only you know. Your setup code can be used once."
                  : "Enter your account email. An administrator will receive a reset request inside the store."}
        </p>
        {mode==='login'&&methods&&<p><a href={'/login?next='+encodeURIComponent(typeof window==='undefined'?'/':new URLSearchParams(window.location.search).get('next')||'/')}>Use Google, Personal Microsoft or a passkey</a></p>}
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <label className="field">
              <span>Email address</span>
              <Input
                name="email"
                type="email"
                autoComplete="username"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={mode === "setup"}
              />
            </label>
            {["first", "recovery"].includes(mode) ? (
              <label className="field">
                <span>{mode === "first" ? "Setup code" : "Recovery code"}</span>
                <Input
                  name="code"
                  autoComplete="one-time-code"
                  maxLength={80}
                  required
                />
              </label>
            ) : null}
            {["login", "setup", "recovery"].includes(mode) ? (
              <label className="field">
                <span>{mode !== "login" ? "New password" : "Password"}</span>
                <Input
                  name="password"
                  type="password"
                  autoComplete={
                    mode !== "login" ? "new-password" : "current-password"
                  }
                  required
                  minLength={mode !== "login" ? 15 : undefined}
                  maxLength={128}
                />
              </label>
            ) : null}
            {["setup", "recovery"].includes(mode) ? (
              <>
                <label className="field">
                  <span>Confirm new password</span>
                  <Input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    minLength={15}
                    maxLength={128}
                    required
                  />
                </label>
                <p className="fine">
                  Use 15–128 characters. A phrase of several words works well.
                </p>
              </>
            ) : null}
            <div
              ref={widget}
              className="security-challenge"
              aria-label="Security check"
            />
            {error ? (
              <p className="notice error" role="alert">
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="notice" role="status">
                {message}
              </p>
            ) : null}
            <Button
              type="submit"
              className="full"
              disabled={busy || !challengeToken}
            >
              {busy
                ? "Please wait…"
                : mode === "login"
                  ? "Sign in"
                  : mode === "first"
                    ? "Continue"
                    : ["setup", "recovery"].includes(mode)
                      ? "Save password & sign in"
                      : "Request a reset"}
            </Button>
          </fieldset>
        </form>
        {mode === "login" ? (
          <div className="login-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => change("first")}
            >
              First Time
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => change("forgot")}
            >
              Forgot password?
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => change("recovery")}
            >
              Use recovery code
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => change("login")}
          >
            Back to sign-in
          </Button>
        )}
        <p className="fine">Pickup only · Access by approved email.</p>
        <nav className="identity-links" aria-label="App information"><a href="/about">About the app</a><a href="/privacy">Privacy policy</a></nav>
        {mode === "login" ? (
          <p className="fine">
            Sessions expire automatically. Administrators sign in more often to
            protect store controls. Use a personal device.
          </p>
        ) : null}
      </section>
    </main>
  );
}
