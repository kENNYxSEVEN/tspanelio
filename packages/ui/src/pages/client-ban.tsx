import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth } from "@/auth/auth-context"
import { AppSelect } from "@/components/app-select"
import { ToastStack, useToastStack } from "@/components/toast-stack"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type ClientDbInfo = {
  clientLastip?: string
  clientNickname?: string
  clientUniqueIdentifier?: string
  [key: string]: unknown
}

type BanFormState = {
  ip: string
  name: string
  reason: string
  time: string
  uid: string
  unit: string
}

const timeUnits = [
  { label: "seconds", value: "1" },
  { label: "minutes", value: "60" },
  { label: "hours", value: "3600" },
  { label: "days", value: "86400" },
  { label: "permanent", value: "0" },
]

const clientBanFlights = new Map<string, Promise<ClientDbInfo>>()

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

  return "TeamSpeak request failed."
}

function isUsableServerId(value: string | number | undefined | null) {
  return (
    value !== undefined &&
    value !== null &&
    String(value) !== "" &&
    String(value) !== "0"
  )
}

function getOptimalTimeUnit(seconds: number) {
  if (!seconds) {
    return "0"
  }

  if (Number.isInteger(seconds / 86400)) {
    return "86400"
  }

  if (Number.isInteger(seconds / 3600)) {
    return "3600"
  }

  if (Number.isInteger(seconds / 60)) {
    return "60"
  }

  return "1"
}

function createDefaultForm(): BanFormState {
  const seconds = 86400
  const unit = getOptimalTimeUnit(seconds)

  return {
    ip: "",
    name: "",
    reason: "",
    time: String(seconds / Number(unit || 1)),
    uid: "",
    unit,
  }
}

export function ClientBan() {
  const navigate = useNavigate()
  const { cldbid } = useParams()
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const queryUserRef = useRef(queryUser)
  const { dismissToast, showError, toasts } = useToastStack()
  const [form, setForm] = useState<BanFormState>(() => createDefaultForm())
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    queryUserRef.current = queryUser
  }, [queryUser])

  const selectedServerId = useMemo(() => {
    if (isUsableServerId(queryUser.virtualserverId)) {
      return queryUser.virtualserverId
    }

    if (isUsableServerId(serverId)) {
      return serverId
    }

    return undefined
  }, [queryUser.virtualserverId, serverId])

  const ensureSelectedServer = useCallback(async () => {
    if (!isUsableServerId(selectedServerId)) {
      throw new Error("No valid virtual server selected.")
    }

    const validSelectedServerId = selectedServerId as string | number
    const currentQueryUser = queryUserRef.current

    if (
      isUsableServerId(currentQueryUser.virtualserverId) &&
      String(currentQueryUser.virtualserverId) === String(validSelectedServerId)
    ) {
      saveServerId(validSelectedServerId)
      return currentQueryUser
    }

    const nextQueryUser = await TeamSpeak.selectServer(validSelectedServerId)

    saveServerId(validSelectedServerId)

    if (nextQueryUser) {
      saveQueryUser(nextQueryUser)
    }

    return nextQueryUser
  }, [saveQueryUser, saveServerId, selectedServerId])

  const loadClientDbInfo = useCallback(async () => {
    if (!cldbid) {
      throw new Error("Client database id is missing.")
    }

    await ensureSelectedServer()

    let flight = clientBanFlights.get(cldbid)

    if (!flight) {
      flight = TeamSpeak.execute<ClientDbInfo[]>("clientdbinfo", { cldbid })
        .then((clientdbinfo) => clientdbinfo[0] ?? {})
        .finally(() => {
          clientBanFlights.delete(cldbid)
        })

      clientBanFlights.set(cldbid, flight)
    }

    return flight
  }, [cldbid, ensureSelectedServer])

  useEffect(() => {
    let active = true

    setLoading(true)

    loadClientDbInfo()
      .then((clientDbInfo) => {
        if (!active) {
          return
        }

        setForm((currentForm) => ({
          ...currentForm,
          ip: clientDbInfo.clientLastip ? String(clientDbInfo.clientLastip) : "",
          uid: clientDbInfo.clientUniqueIdentifier
            ? String(clientDbInfo.clientUniqueIdentifier)
            : "",
        }))
      })
      .catch((loadError: unknown) => {
        if (active) {
          showError(getErrorMessage(loadError))
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [loadClientDbInfo, showError])

  const updateForm = (field: keyof BanFormState, value: string) => {
    setForm((currentForm) => ({ ...currentForm, [field]: value }))
  }

  const submitDisabled =
    loading || submitting || (!form.ip.trim() && !form.name.trim() && !form.uid.trim())

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)

    try {
      await ensureSelectedServer()

      const unit = Number(form.unit)
      const time = unit === 0 ? 0 : Number(form.time || 0) * unit

      await TeamSpeak.execute("banadd", {
        ip: form.ip,
        name: form.name,
        uid: form.uid,
        banreason: form.reason,
        time,
      })

      navigate(-1)
    } catch (submitError) {
      showError(getErrorMessage(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  const busy = loading || submitting

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Card>
        <CardHeader>
          <CardTitle>Ban Client</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              Loading...
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              
                <div className="space-y-2">
                  <Label htmlFor="banIp">IP</Label>
                  <Input
                    disabled={busy}
                    id="banIp"
                    value={form.ip}
                    onChange={(event) => updateForm("ip", event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="banName">Name</Label>
                  <Input
                    disabled={busy}
                    id="banName"
                    value={form.name}
                    onChange={(event) => updateForm("name", event.target.value)}
                  />
                </div>
              

              <div className="space-y-2">
                <Label htmlFor="banUid">Unique ID</Label>
                <Input
                  disabled={busy}
                  id="banUid"
                  value={form.uid}
                  onChange={(event) => updateForm("uid", event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="banReason">Reason</Label>
                <textarea
                  className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={busy}
                  id="banReason"
                  value={form.reason}
                  onChange={(event) => updateForm("reason", event.target.value)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="banDuration">Duration</Label>
                  <Input
                    disabled={busy || form.unit === "0"}
                    id="banDuration"
                    min="0"
                    type="number"
                    value={form.time}
                    onChange={(event) => updateForm("time", event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="banUnit">Unit</Label>
                  <AppSelect
                    className="h-9"
                    disabled={busy}
                    options={timeUnits}
                    placeholder="Unit"
                    value={form.unit}
                    onChange={(value) => updateForm("unit", value)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-1 max-sm:[&>*]:w-full">
                <Button disabled={submitDisabled} type="submit">
                  {submitting ? "Saving..." : "OK"}
                </Button>
                <Button
                  disabled={busy}
                  type="button"
                  variant="outline"
                  onClick={() => navigate(-1)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
