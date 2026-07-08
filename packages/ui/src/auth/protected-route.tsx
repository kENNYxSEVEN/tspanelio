import { useEffect, useState } from "react"
import { Navigate, Outlet, useLocation } from "react-router-dom"

import { useAuth } from "@/auth/auth-context"

export function ProtectedRoute() {
  const location = useLocation()
  const {
    connected,
    hasTriedRestore,
    restoreSession,
    restoringSession,
    token,
  } = useAuth()
  const [restoreFailed, setRestoreFailed] = useState(false)

  useEffect(() => {
    if (connected || restoringSession || hasTriedRestore || !token) {
      return
    }

    let active = true

    restoreSession().then((restored) => {
      if (active && !restored) {
        setRestoreFailed(true)
      }
    })

    return () => {
      active = false
    }
  }, [connected, hasTriedRestore, restoreSession, restoringSession, token])

  if (connected) {
    return <Outlet />
  }

  if (restoringSession || (token && !hasTriedRestore && !restoreFailed)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading...
      </div>
    )
  }

  return <Navigate to="/login" replace state={{ from: location }} />
}

