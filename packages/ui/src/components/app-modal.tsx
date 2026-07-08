import {
  useEffect,
  type MouseEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

export function AppModal({
  children,
  className,
  footer,
  onClose,
  open,
  preventClose = false,
  title,
}: {
  children: ReactNode
  className?: string
  footer?: ReactNode
  onClose: () => void
  open: boolean
  preventClose?: boolean
  title?: ReactNode
}) {
  useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !preventClose) {
        onClose()
      }
    }

    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose, open, preventClose])

  if (!open || typeof document === "undefined") {
    return null
  }

  const handleBackdropClick = () => {
    if (!preventClose) {
      onClose()
    }
  }

  const handleContentClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4"
      onClick={handleBackdropClick}
    >
      <div
        aria-modal="true"
        className={cn(
          "flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-lg",
          className,
        )}
        role="dialog"
        onClick={handleContentClick}
      >
        {title ? (
          <div className="flex shrink-0 flex-col space-y-1.5 p-6">
            <h2 className="text-lg font-semibold leading-none tracking-tight">
              {title}
            </h2>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-0">
          {children}
        </div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 p-6 pt-0 max-sm:[&>*]:flex-1">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
