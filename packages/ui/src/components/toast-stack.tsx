import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react"

import { cn } from "@/lib/utils"

export type ToastVariant = "success" | "error" | "warning" | "info"

export type ToastOptions = {
  duration?: number
  message: string
  variant?: ToastVariant
}

export type Toast = {
  duration: number
  entering: boolean
  id: number
  leaving: boolean
  message: string
  variant: ToastVariant
}

const DEFAULT_DURATION = 4500
const ENTER_DELAY = 20
const REMOVE_DELAY = 260

const variantConfig = {
  success: {
    icon: CheckCircle2,
    className:
      "border-emerald-500/40 bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950",
    focusClassName: "focus-visible:ring-white/70 dark:focus-visible:ring-emerald-950/70",
  },
  error: {
    icon: AlertCircle,
    className:
      "border-destructive/40 bg-destructive text-destructive-foreground",
    focusClassName: "focus-visible:ring-destructive-foreground/70",
  },
  warning: {
    icon: TriangleAlert,
    className:
      "border-amber-500/40 bg-amber-500 text-amber-950 dark:bg-amber-400 dark:text-amber-950",
    focusClassName: "focus-visible:ring-amber-950/70",
  },
  info: {
    icon: Info,
    className:
      "border-border bg-popover text-popover-foreground dark:border-sky-500/30",
    focusClassName: "focus-visible:ring-ring",
  },
} satisfies Record<
  ToastVariant,
  {
    className: string
    focusClassName: string
    icon: typeof AlertCircle
  }
>

export function useToastStack() {
  const toastIdRef = useRef(0)
  const toastTimersRef = useRef<Map<number, number[]>>(new Map())
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismissToast = useCallback((toastId: number) => {
    setToasts((currentToasts) =>
      currentToasts.map((toast) =>
        toast.id === toastId ? { ...toast, leaving: true } : toast,
      ),
    )

    const removeTimerId = window.setTimeout(() => {
      setToasts((currentToasts) =>
        currentToasts.filter((toast) => toast.id !== toastId),
      )

      const timerIds = toastTimersRef.current.get(toastId) ?? []

      for (const timerId of timerIds) {
        window.clearTimeout(timerId)
      }

      toastTimersRef.current.delete(toastId)
    }, REMOVE_DELAY)

    const timerIds = toastTimersRef.current.get(toastId) ?? []
    toastTimersRef.current.set(toastId, [...timerIds, removeTimerId])
  }, [])

  const showToast = useCallback(
    ({ duration = DEFAULT_DURATION, message, variant = "info" }: ToastOptions) => {
      if (!message) {
        return
      }

      const toastId = toastIdRef.current + 1
      toastIdRef.current = toastId

      setToasts((currentToasts) => [
        {
          duration,
          entering: true,
          id: toastId,
          leaving: false,
          message,
          variant,
        },
        ...currentToasts,
      ])

      const enterTimerId = window.setTimeout(() => {
        setToasts((currentToasts) =>
          currentToasts.map((toast) =>
            toast.id === toastId ? { ...toast, entering: false } : toast,
          ),
        )
      }, ENTER_DELAY)

      const leaveTimerId = window.setTimeout(() => {
        dismissToast(toastId)
      }, duration)

      toastTimersRef.current.set(toastId, [enterTimerId, leaveTimerId])
    },
    [dismissToast],
  )

  const showSuccess = useCallback(
    (message: string, duration?: number) => {
      showToast({ duration, message, variant: "success" })
    },
    [showToast],
  )

  const showError = useCallback(
    (message: string | null, duration?: number) => {
      if (!message) {
        return
      }

      showToast({ duration, message, variant: "error" })
    },
    [showToast],
  )

  const showWarning = useCallback(
    (message: string, duration?: number) => {
      showToast({ duration, message, variant: "warning" })
    },
    [showToast],
  )

  const showInfo = useCallback(
    (message: string, duration?: number) => {
      showToast({ duration, message, variant: "info" })
    },
    [showToast],
  )

  useEffect(() => {
    return () => {
      for (const timerIds of toastTimersRef.current.values()) {
        for (const timerId of timerIds) {
          window.clearTimeout(timerId)
        }
      }

      toastTimersRef.current.clear()
    }
  }, [])

  return {
    dismissToast,
    showError,
    showInfo,
    showSuccess,
    showToast,
    showWarning,
    toasts,
  }
}

export function ToastStack({
  onDismiss,
  toasts,
}: {
  onDismiss: (toastId: number) => void
  toasts: Toast[]
}) {
  if (!toasts.length) {
    return null
  }

  return (
    <div className="pointer-events-none fixed right-5 top-4 z-[100] flex w-[min(420px,calc(100vw-2.5rem))] flex-col gap-2">
      {toasts.map((toast) => {
        const config = variantConfig[toast.variant]
        const Icon = config.icon

        return (
          <div
            className={cn(
              "pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg transition-all duration-300 ease-out",
              config.className,
            )}
            key={toast.id}
            role={toast.variant === "error" ? "alert" : "status"}
            style={{
              opacity: toast.entering || toast.leaving ? 0 : 1,
              transform:
                toast.entering || toast.leaving
                  ? "translateX(calc(100% + 24px)) scale(0.98)"
                  : "translateX(0) scale(1)",
            }}
          >
            <div className="flex items-start gap-3">
              <Icon className="mt-0.5 size-5 shrink-0" />
              <div className="min-w-0 flex-1 font-medium">{toast.message}</div>
              <button
                className={cn(
                  "rounded-sm opacity-80 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2",
                  config.focusClassName,
                )}
                type="button"
                onClick={() => onDismiss(toast.id)}
              >
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
