import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

type Theme = "light" | "dark" | "system"

type ThemeProviderValue = {
  theme: Theme
  resolvedTheme: "light" | "dark"
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeProviderValue | undefined>(undefined)
const storageKey = "tspanelio-theme"

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark")
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") {
      return "system"
    }

    const storedTheme = window.localStorage.getItem(storageKey)

    return storedTheme === "light" ||
      storedTheme === "dark" ||
      storedTheme === "system"
      ? storedTheme
      : "system"
  })
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light")

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")

    const updateTheme = () => {
      const nextResolvedTheme = theme === "system" ? getSystemTheme() : theme

      setResolvedTheme(nextResolvedTheme)
      applyTheme(nextResolvedTheme)
    }

    updateTheme()
    media.addEventListener("change", updateTheme)

    return () => media.removeEventListener("change", updateTheme)
  }, [theme])

  const setTheme = (nextTheme: Theme) => {
    window.localStorage.setItem(storageKey, nextTheme)
    setThemeState(nextTheme)
  }

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [resolvedTheme, theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }

  return context
}
