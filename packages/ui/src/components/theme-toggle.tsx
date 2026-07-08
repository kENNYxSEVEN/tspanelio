import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useTheme } from "@/theme/theme-provider"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      document.documentElement.classList.contains("dark"))

  const toggleTheme = () => {
    setTheme(isDark ? "light" : "dark")
  }

  return (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    className="relative"
    onClick={toggleTheme}
    aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
    title={isDark ? "Switch to light theme" : "Switch to dark theme"}
  >
    <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
    <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
  </Button>
)
}