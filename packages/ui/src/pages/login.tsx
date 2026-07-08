import { useEffect, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth } from "@/auth/auth-context"
import { ThemeToggle } from "@/components/theme-toggle"
import { ToastStack, useToastStack } from "@/components/toast-stack"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type LoginForm = {
  host: string
  queryport: number
  ssh: boolean
  username: string
  password: string
}

const defaultForm: LoginForm = {
  host: "",
  queryport: 10022,
  ssh: true,
  username: "",
  password: "",
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message)
  }

  if (typeof error === "string") {
    return error
  }

  return "Unable to connect to TeamSpeak ServerQuery."
}

export function LoginPage() {
  const navigate = useNavigate()
  const {
    token,
    connected,
    rememberLogin,
    saveToken,
    removeToken,
    setConnected,
    setLoggedOut,
    setRememberLogin,
  } = useAuth()
  const { dismissToast, showError, toasts } = useToastStack()
  const [form, setForm] = useState<LoginForm>(defaultForm)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoggedOut(true)

    if (connected) {
      navigate("/servers", { replace: true })
      return
    }

    if (!token) {
      return
    }

    let active = true

    TeamSpeak.autofillForm(token)
      .then((response) => {
        if (!active) {
          return
        }

        setForm({
          host: response.host ?? "",
          queryport: response.queryport ?? 10022,
          ssh: response.protocol === "ssh",
          username: response.username ?? "",
          password: response.password ?? "",
        })
      })
      .catch((autofillError: unknown) => {
        if (!active) {
          return
        }

        removeToken()
        showError(getErrorMessage(autofillError))
      })

    return () => {
      active = false
    }
  }, [connected, navigate, removeToken, setLoggedOut, showError, token])

  const updateField = <Key extends keyof LoginForm>(
    key: Key,
    value: LoginForm[Key],
  ) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const updateSsh = (ssh: boolean) => {
    setForm((current) => ({
      ...current,
      ssh,
      queryport: ssh ? 10022 : 10011,
    }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)

    try {
      const response = await TeamSpeak.connect({
        host: form.host,
        queryport: form.queryport,
        protocol: form.ssh ? "ssh" : "raw",
        username: form.username,
        password: form.password,
      })

      saveToken(response.token)
      setConnected(true)
      setLoggedOut(false)
      void TeamSpeak.bootstrapConnection({ progress: "background" }).catch(
        () => undefined,
      )
      navigate("/servers", { state: { from: "/login" } })
    } catch (connectError) {
      showError(getErrorMessage(connectError))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:px-6">
        <div />

        <ThemeToggle />
      </header>

      <main className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>TSPanelio</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_7rem]">
                <div className="space-y-2">
                  <Label htmlFor="host">Server</Label>
                  <Input
                    id="host"
                    placeholder="IP or Domain"
                    required
                    value={form.host}
                    onChange={(event) => updateField("host", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="queryport">Port</Label>
                  <Input
                    id="queryport"
                    min={1}
                    required
                    type="number"
                    value={form.queryport}
                    onChange={(event) =>
                      updateField("queryport", Number(event.target.value))
                    }
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="ssh"
                  checked={form.ssh}
                  onCheckedChange={(checked) => updateSsh(checked === true)}
                />
                <Label htmlFor="ssh">SSH</Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="username">Name</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  name="username"
                  placeholder="e.g. serveradmin"
                  required
                  value={form.username}
                  onChange={(event) => updateField("username", event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  autoComplete="current-password"
                  name="password"
                  required
                  type="password"
                  value={form.password}
                  onChange={(event) => updateField("password", event.target.value)}
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="rememberLogin"
                  checked={rememberLogin}
                  onCheckedChange={(checked) => setRememberLogin(checked === true)}
                />
                <Label htmlFor="rememberLogin">Remember me</Label>
              </div>

              <Button className="w-full" disabled={loading} type="submit">
                {loading ? "Connecting..." : "Connect"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>

    </div>
  )
}
