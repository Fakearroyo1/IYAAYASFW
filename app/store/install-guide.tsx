"use client";
import { useEffect, useState } from "react";
import { Download, Share, PlusSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export default function InstallGuide() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null),
    [installed, setInstalled] = useState(false),
    [help, setHelp] = useState(false),
    [ios, setIos] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)"),
      standalone = () =>
        setInstalled(
          media.matches ||
            !!(navigator as Navigator & { standalone?: boolean }).standalone,
        );
    standalone();
    setIos(
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    );
    const before = (e: Event) => {
        e.preventDefault();
        setPrompt(e as InstallEvent);
      },
      done = () => {
        setInstalled(true);
        setPrompt(null);
      };
    window.addEventListener("beforeinstallprompt", before);
    window.addEventListener("appinstalled", done);
    media.addEventListener("change", standalone);
    return () => {
      window.removeEventListener("beforeinstallprompt", before);
      window.removeEventListener("appinstalled", done);
      media.removeEventListener("change", standalone);
    };
  }, []);
  if (installed) return null;
  async function install() {
    if (!prompt) {
      setHelp((v) => !v);
      return;
    }
    try {
      await prompt.prompt();
      const result = await prompt.userChoice;
      if (result.outcome === "accepted")
        setMessage(
          "Installation requested. Look for Unit Supply on your home screen.",
        );
      else setHelp(true);
    } catch {
      setHelp(true);
    } finally {
      setPrompt(null);
    }
  }
  return (
    <section className="install-guide">
      <div>
        <strong>A faster way back</strong>
        <p className="fine">
          Add Unit Supply to your home screen for one-tap access.
        </p>
      </div>
      <Button type="button" variant="outline" onClick={install}>
        <Download size={17} />
        {prompt ? "Install Unit Supply" : "Add to home screen"}
      </Button>
      {help ? (
        <div className="install-help">
          <p>
            {ios ? (
              <>
                <Share size={16} /> Open this site in Safari. Tap Share, then{" "}
                <PlusSquare size={16} /> Add to Home Screen, and confirm Add.
              </>
            ) : (
              <>
                Open your browser’s menu and choose Install app or Add to Home
                screen. On desktop, look for the install icon beside the address
                bar. If installation is unavailable, bookmark this page.
              </>
            )}
          </p>
          <p className="fine">
            Your account stays the same. Sign in if prompted. An internet
            connection is needed to load stock and record purchases.
          </p>
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
