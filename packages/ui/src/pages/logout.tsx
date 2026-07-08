import { useEffect } from "react"
import { useNavigate } from "react-router-dom"

import { socket } from "@/api/socket"
import { useAuth } from "@/auth/auth-context"

export function LogoutPage() {
  const navigate = useNavigate()
  const { clearSession } = useAuth()

  useEffect(() => {
    clearSession()

    if (socket.connected) {
      socket.disconnect()
    }

    navigate("/login", { replace: true })
  }, [clearSession, navigate])

  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
      Signing out...
    </div>
  )
}
