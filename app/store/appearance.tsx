"use client";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
function choose(value: string) {
  try {
    localStorage.setItem("supply-theme", value);
  } catch {}
  document.documentElement.dataset.theme = value;
  document.documentElement.classList.toggle(
    "dark",
    value === "dark" ||
      (value === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches),
  );
  window.dispatchEvent(new Event("supply-theme-changed"));
}
function useAppearance() {
  const [theme, setTheme] = useState("system"),
    [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => {
      setTheme(document.documentElement.dataset.theme || "system");
      setDark(document.documentElement.classList.contains("dark"));
    };
    read();
    window.addEventListener("supply-theme-changed", read);
    return () => window.removeEventListener("supply-theme-changed", read);
  }, []);
  return { theme, dark };
}
export function ThemeToggle() {
  const { dark } = useAppearance();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => choose(dark ? "light" : "dark")}
    >
      {dark ? <Sun size={19} /> : <Moon size={19} />}
    </Button>
  );
}
export function ThemePicker() {
  const { theme } = useAppearance();
  return (
    <label className="theme-picker">
      <Monitor size={19} />
      <span>Appearance</span>
      <NativeSelect
        aria-label="Appearance"
        value={theme}
        onChange={(e) => choose(e.target.value)}
      >
        <option value="system">Use device setting</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </NativeSelect>
    </label>
  );
}
export function BrandMark() {
  return (
    <span className="brand-mark">
      <img src="/brand/logo.png" alt="" width={48} height={48} />
    </span>
  );
}
