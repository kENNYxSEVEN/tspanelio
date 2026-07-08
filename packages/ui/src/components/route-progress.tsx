import { useEffect, useSyncExternalStore } from "react"
import { useLocation } from "react-router-dom"

import {
  getLoadingSnapshot,
  startLoading,
  stopLoading,
  subscribeLoading,
} from "@/lib/loading-progress"

export function RouteProgress() {
  const location = useLocation()
  const { active, progress } = useSyncExternalStore(
    subscribeLoading,
    getLoadingSnapshot,
    getLoadingSnapshot,
  )

  useEffect(() => {
    let stopped = false

    const finish = () => {
      if (stopped) {
        return
      }

      stopped = true
      stopLoading()
    }

    startLoading()

    const timerId = window.setTimeout(finish, 250)

    return () => {
      window.clearTimeout(timerId)
      finish()
    }
  }, [location.pathname, location.search])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[2147483647] h-1 overflow-hidden bg-transparent"
    >
      <div
        className="h-full bg-primary shadow-[0_0_12px_hsl(var(--primary))] transition-[width,opacity] duration-200 ease-out"
        style={{
          opacity: active ? 1 : 0,
          width: active ? String(progress) + "%" : "0%",
        }}
      />
    </div>
  )
}

