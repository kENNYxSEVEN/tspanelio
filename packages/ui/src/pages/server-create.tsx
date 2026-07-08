import { CheckCircle2, Copy, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth } from "@/auth/auth-context"
import { ToastStack, useToastStack } from "@/components/toast-stack"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { copyTextToClipboard } from "@/lib/clipboard"

type ServerRow = {
  virtualserverPort?: string | number
  [key: string]: unknown
}

type CreateServerForm = {
  maxClients: string
  serverName: string
  serverPort: string
}

type ServerCreateResponse = {
  sid?: string | number
  token?: string
  [key: string]: unknown
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message)
  }
  if (typeof error === "string") return error
  return "TeamSpeak request failed."
}

function getAvailablePort(servers: ServerRow[]) {
  const ports = servers
    .map((server) => Number(server.virtualserverPort))
    .filter((port) => Number.isFinite(port))

  if (!ports.length) {
    return 9987
  }

  return Math.max(...ports) + 1
}

function isValidForm(form: CreateServerForm) {
  return (
    form.serverName.trim() !== "" &&
    Number(form.serverPort) > 0 &&
    Number(form.maxClients) > 0
  )
}

export function ServerCreate() {
  const navigate = useNavigate()
  const { saveQueryUser, saveServerId } = useAuth()
  const { dismissToast, showError, showSuccess, toasts } = useToastStack()
  const serverListFlightRef = useRef<Promise<ServerRow[]> | null>(null)
  const [form, setForm] = useState<CreateServerForm>({
    maxClients: "32",
    serverName: "",
    serverPort: "",
  })
  const [creating, setCreating] = useState(false)
  const [createdServer, setCreatedServer] = useState<ServerCreateResponse | null>(
    null,
  )

  const valid = useMemo(() => isValidForm(form), [form])

  useEffect(() => {
    let active = true

    if (!serverListFlightRef.current) {
      serverListFlightRef.current = TeamSpeak.execute<ServerRow[]>("serverlist")
        .then((servers) => (Array.isArray(servers) ? servers : []))
        .finally(() => {
          serverListFlightRef.current = null
        })
    }

    serverListFlightRef.current
      .then((servers) => {
        if (!active) return

        setForm((currentForm) => {
          if (currentForm.serverPort.trim() !== "") {
            return currentForm
          }

          return {
            ...currentForm,
            serverPort: String(getAvailablePort(servers)),
          }
        })
      })
      .catch((error: unknown) => {
        if (active) showError(getErrorMessage(error))
      })

    return () => {
      active = false
    }
  }, [showError])

  const updateField = (field: keyof CreateServerForm, value: string) => {
    setForm((currentForm) => ({ ...currentForm, [field]: value }))
  }

  const createServer = async () => {
    if (!valid) {
      showError("Fill all required fields first.")
      return
    }

    setCreating(true)

    try {
      const response = await TeamSpeak.execute<ServerCreateResponse[]>(
        "servercreate",
        {
          virtualserverMaxclients: Number(form.maxClients),
          virtualserverName: form.serverName.trim(),
          virtualserverPort: Number(form.serverPort),
        },
      )
      const created = response[0] ?? {}

      setCreatedServer(created)
      showSuccess("Server successfully created")

      if (created.sid !== undefined) {
        await TeamSpeak.selectServer(created.sid, { progress: "background" })
        saveServerId(created.sid)

        const nextQueryUser = await TeamSpeak.ensureQueryIdentity({
          progress: "background",
        })

        if (nextQueryUser) {
          saveQueryUser(nextQueryUser)
        }
      }
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setCreating(false)
    }
  }

  const copyToken = async () => {
    if (!createdServer?.token) {
      return
    }

    try {
      await copyTextToClipboard(createdServer.token)
      showSuccess("Token copied")
    } catch {
      showError("Could not copy token.")
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Card>
        <CardHeader>
          <div className="flex items-start pb-3 gap-3">
            <div>
              <CardTitle>Create Server</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="server-name">Name</Label>
            <Input
              id="server-name"
              disabled={creating}
              value={form.serverName}
              onChange={(event) => updateField("serverName", event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="server-port">Port</Label>
              <Input
                id="server-port"
                disabled={creating}
                min={1}
                type="number"
                value={form.serverPort}
                onChange={(event) => updateField("serverPort", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="server-max-clients">Max. Clients</Label>
              <Input
                id="server-max-clients"
                disabled={creating}
                min={1}
                type="number"
                value={form.maxClients}
                onChange={(event) => updateField("maxClients", event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            {createdServer?.token ? (
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-4" />
                Server token generated
              </div>
            ) : null}
            <div className="flex min-w-0 gap-2">
              <Input
                id="generated-server-token"
                readOnly
                placeholder="Generated Server Token"
                value={createdServer?.token ?? ""}
              />
              {createdServer?.token ? (
                <Button
                  aria-label="Copy generated server token"
                  size="icon"
                  type="button"
                  variant="outline"
                  onClick={copyToken}
                >
                  <Copy className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex-wrap justify-end gap-2 max-sm:[&>*]:w-full">
          <Button
            disabled={!valid || creating}
            type="button"
            onClick={createServer}
          >
            {creating ? "Creating..." : "Create"}
          </Button>
          <Button
            disabled={creating}
            type="button"
            variant="outline"
            onClick={() => navigate(-1)}
          >
            <X className="size-4" />
            Close
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
