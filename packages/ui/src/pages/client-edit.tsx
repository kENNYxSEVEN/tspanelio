import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ChevronDown } from "lucide-react"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth } from "@/auth/auth-context"
import { ToastStack, useToastStack } from "@/components/toast-stack"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type ClientInfo = {
  clientNickname?: string
  clientDescription?: string
  clientDatabaseId?: string | number
  clientServergroups?: Array<string | number>
  [key: string]: unknown
}

type ServerGroup = {
  sgid: string | number
  name: string
  type: string | number
  [key: string]: unknown
}

type ClientEditData = {
  client: ClientInfo
  servergroups: ServerGroup[]
  defaultServerGroupId?: string | number
}

const clientEditFlights = new Map<string, Promise<ClientEditData>>()

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

function normalizeGroupIds(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) => String(item))
}

function getServerGroupTypeName(type: string | number) {
  switch (Number(type)) {
    case 1:
      return "Regular Group"
    case 2:
      return "ServerQuery Group"
    default:
      return "Group"
  }
}

function canSelectGroup(group: ServerGroup, defaultServerGroupId?: string | number) {
  if (String(group.sgid) === String(defaultServerGroupId ?? "")) {
    return false
  }

  return Number(group.type) !== 2
}

function FloatingTextarea({
  disabled,
  id,
  label,
  onChange,
  value,
}: {
  disabled: boolean
  id: string
  label: string
  onChange: (value: string) => void
  value: string
}) {
  const [focused, setFocused] = useState(false)
  const active = focused || value.length > 0

  return (
    <div
      className={cn(
        "relative min-h-32 border-b transition-colors",
        focused ? "border-primary" : "border-border",
        disabled && "opacity-60",
      )}
    >
      <Label
        className={cn(
          "pointer-events-none absolute left-0 transition-all",
          active
            ? "top-0 text-xs text-primary"
            : "top-5 text-sm text-muted-foreground",
        )}
        htmlFor={id}
      >
        {label}
      </Label>
      <textarea
        className="min-h-32 w-full resize-y bg-transparent pb-2 pt-6 text-sm outline-none disabled:cursor-not-allowed"
        disabled={disabled}
        id={id}
        value={value}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
      />
    </div>
  )
}

function ServerGroupPicker({
  disabled,
  groups,
  selectedGroups,
  defaultServerGroupId,
  onChange,
}: {
  disabled: boolean
  groups: ServerGroup[]
  selectedGroups: string[]
  defaultServerGroupId?: string | number
  onChange: (sgid: string | number, selected: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        pickerRef.current &&
        event.target instanceof Node &&
        !pickerRef.current.contains(event.target)
      ) {
        setOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    const timerId = window.setTimeout(() => {
      const firstSelectedGroup = listRef.current?.querySelector<HTMLElement>(
        "[data-server-group-selected='true']",
      )

      firstSelectedGroup?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      })
    }, 80)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [open, selectedGroups])

  const selectedGroupObjects = groups.filter((group) =>
    selectedGroups.includes(String(group.sgid)),
  )

  return (
    <div className="relative" ref={pickerRef}>
      <button
        className={cn(
          "relative flex min-h-12 w-full items-end gap-2 border-b bg-transparent pb-1 pt-5 text-left text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          open ? "border-primary" : "border-border",
        )}
        disabled={disabled}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <Label
          className={cn(
            "pointer-events-none absolute left-0 top-0 text-xs transition-colors",
            open ? "text-primary" : "text-muted-foreground",
          )}
        >
          Servergroups
        </Label>

        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {selectedGroupObjects.length ? (
            selectedGroupObjects.map((group) => {
              const selectable = canSelectGroup(group, defaultServerGroupId)

              return (
                <span
                  className={cn(
                    "max-w-full rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground",
                    open &&
                      selectedGroups.includes(String(group.sgid)) &&
                      selectable &&
                      "bg-primary/15 text-primary",
                  )}
                  key={String(group.sgid)}
                >
                  {group.name}
                </span>
              )
            })
          ) : (
            <span className="text-muted-foreground">Select server groups</span>
          )}
        </div>

        <ChevronDown
          className={cn(
            "mb-1 size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180 text-primary",
          )}
        />
      </button>

      {open ? (
        <div
          ref={listRef}
          className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-50 max-h-80 overflow-y-auto rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
        >
          {groups.length ? (
            groups.map((group) => {
              const groupId = String(group.sgid)
              const selectable = canSelectGroup(group, defaultServerGroupId)
              const selected = selectedGroups.includes(groupId)

              return (
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                    !selectable && "cursor-not-allowed opacity-50 hover:bg-transparent",
                    selected && selectable && "text-primary",
                  )}
                  data-server-group-selected={selected ? "true" : undefined}
                  key={groupId}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  <Checkbox
                    checked={selected}
                    disabled={disabled || !selectable}
                    onCheckedChange={(checked) => onChange(group.sgid, checked === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium leading-tight">
                      {group.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {getServerGroupTypeName(group.type)}
                    </span>
                  </span>
                </label>
              )
            })
          ) : (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No server groups found.
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

export function ClientEdit() {
  const navigate = useNavigate()
  const { clid } = useParams()
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const queryUserRef = useRef(queryUser)
  const { dismissToast, showError, showSuccess, toasts } = useToastStack()
  const [client, setClient] = useState<ClientInfo>({})
  const [servergroups, setServergroups] = useState<ServerGroup[]>([])
  const [defaultServerGroupId, setDefaultServerGroupId] =
    useState<string | number | undefined>()
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const [initialGroups, setInitialGroups] = useState<string[]>([])
  const [description, setDescription] = useState("")
  const [initialDescription, setInitialDescription] = useState("")
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

  const loadClientEditData = useCallback(async () => {
    if (!clid) {
      throw new Error("Client id is missing.")
    }

    await ensureSelectedServer()

    let flight = clientEditFlights.get(clid)

    if (!flight) {
      flight = (async () => {
        const [clientInfo, servergroupList, serverInfo] = await Promise.all([
          TeamSpeak.execute<ClientInfo[]>("clientinfo", { clid }),
          TeamSpeak.execute<ServerGroup[]>("servergrouplist"),
          TeamSpeak.execute<Array<{ virtualserverDefaultServerGroup?: string | number }>>(
            "serverinfo",
          ),
        ])

        return {
          client: clientInfo[0] ?? {},
          servergroups: servergroupList,
          defaultServerGroupId: serverInfo[0]?.virtualserverDefaultServerGroup,
        }
      })().finally(() => {
        clientEditFlights.delete(clid)
      })

      clientEditFlights.set(clid, flight)
    }

    return flight
  }, [clid, ensureSelectedServer])

  useEffect(() => {
    let active = true

    setLoading(true)

    loadClientEditData()
      .then((data) => {
        if (!active) {
          return
        }

        const nextGroups = normalizeGroupIds(data.client.clientServergroups)
        const nextDescription = data.client.clientDescription
          ? String(data.client.clientDescription)
          : ""

        setClient(data.client)
        setServergroups(data.servergroups)
        setDefaultServerGroupId(data.defaultServerGroupId)
        setSelectedGroups(nextGroups)
        setInitialGroups(nextGroups)
        setDescription(nextDescription)
        setInitialDescription(nextDescription)
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
  }, [loadClientEditData, showError])

  const availableServerGroups = useMemo(
    () =>
      servergroups
        .filter((group) => Number(group.type) === 1 || Number(group.type) === 2)
        .sort((left, right) => Number(left.type) - Number(right.type)),
    [servergroups],
  )

  const updateSelectedGroup = (sgid: string | number, selected: boolean) => {
    const normalizedGroupId = String(sgid)

    setSelectedGroups((currentGroups) => {
      if (selected) {
        return currentGroups.includes(normalizedGroupId)
          ? currentGroups
          : [...currentGroups, normalizedGroupId]
      }

      return currentGroups.filter((groupId) => groupId !== normalizedGroupId)
    })
  }

  const saveClient = async () => {
    if (!clid) {
      throw new Error("Client id is missing.")
    }

    if (!client.clientDatabaseId) {
      throw new Error("Client database id is missing.")
    }

    await ensureSelectedServer()

    if (description !== initialDescription) {
      await TeamSpeak.execute("clientedit", {
        clid,
        clientDescription: description,
      })
    }

    const addGroups = selectedGroups.filter(
      (sgid) => !initialGroups.includes(sgid),
    )
    const removeGroups = initialGroups.filter(
      (sgid) => !selectedGroups.includes(sgid),
    )

    for (const sgid of addGroups) {
      await TeamSpeak.execute("servergroupaddclient", {
        sgid,
        cldbid: client.clientDatabaseId,
      })
    }

    for (const sgid of removeGroups) {
      await TeamSpeak.execute("servergroupdelclient", {
        sgid,
        cldbid: client.clientDatabaseId,
      })
    }
  }

  const refreshInitialState = async () => {
    if (!clid) {
      return
    }

    clientEditFlights.delete(clid)
    const nextData = await loadClientEditData()
    const nextGroups = normalizeGroupIds(nextData.client.clientServergroups)
    const nextDescription = nextData.client.clientDescription
      ? String(nextData.client.clientDescription)
      : ""

    setClient(nextData.client)
    setServergroups(nextData.servergroups)
    setDefaultServerGroupId(nextData.defaultServerGroupId)
    setSelectedGroups(nextGroups)
    setInitialGroups(nextGroups)
    setDescription(nextDescription)
    setInitialDescription(nextDescription)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)

    try {
      await saveClient()
      await refreshInitialState()
      showSuccess("Client updated")
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

      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle>Edit Client</CardTitle>
        </CardHeader>
        <CardContent className="overflow-visible">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              Loading...
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="clientNickname">Nickname</Label>
                <Input
                  disabled
                  id="clientNickname"
                  placeholder={String(client.clientNickname ?? "")}
                />
              </div>

              <FloatingTextarea
                disabled={busy}
                id="clientDescription"
                label="Description"
                value={description}
                onChange={setDescription}
              />

              <ServerGroupPicker
                defaultServerGroupId={defaultServerGroupId}
                disabled={busy}
                groups={availableServerGroups}
                selectedGroups={selectedGroups}
                onChange={updateSelectedGroup}
              />

              <div className="flex flex-wrap justify-end gap-2 pt-1 max-sm:[&>*]:w-full">
                <Button disabled={busy} type="submit">
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
