import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ChevronDown } from "lucide-react"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth } from "@/auth/auth-context"
import { AppModal } from "@/components/app-modal"
import { ToastStack, useToastStack } from "@/components/toast-stack"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type ChannelFormMode = "add" | "edit"

type ChannelFormProps = {
  mode: ChannelFormMode
}

type ChannelRow = {
  cid: string | number
  pid: string | number
  channelName: string
  channelOrder?: string | number
  [key: string]: unknown
}

type ServerInfo = {
  virtualserverName?: string
  [key: string]: unknown
}

type ChannelFormState = {
  channelName: string
  channelPassword: string
  channelTopic: string
  channelDescription: string
  channelOrder: string
  channelMaxclients: string
  channelFlagMaxclientsUnlimited: boolean | null
  channelType: "temporary" | "permanent" | "semi-permanent"
  channelFlagDefault: boolean
  voiceDataEncrypted: boolean
}

type ChannelChanges = {
  channelName?: string
  channelPassword?: string
  channelTopic?: string
  channelDescription?: string
  channelOrder?: number
  channelMaxclients?: number
  channelFlagMaxclientsUnlimited?: number
  channelFlagPermanent?: number
  channelFlagSemiPermanent?: number
  channelFlagDefault?: number
  channelCodecIsUnencrypted?: number
}

type ChannelPageData = {
  channel?: ChannelRow
  channels: ChannelRow[]
  serverInfo: ServerInfo
  parentChannelId: string
}

type SaveAction = "ok" | "apply"

const channelInfoFlights = new Map<string, Promise<ChannelRow>>()
const channelPageDataFlights = new Map<string, Promise<ChannelPageData>>()

const defaultForm: ChannelFormState = {
  channelName: "",
  channelPassword: "",
  channelTopic: "",
  channelDescription: "",
  channelOrder: "0",
  channelMaxclients: "",
  channelFlagMaxclientsUnlimited: null,
  channelType: "temporary",
  channelFlagDefault: false,
  voiceDataEncrypted: false,
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

function toBooleanFlag(value: unknown) {
  return value === true || value === 1 || value === "1"
}

function formFromChannel(channel: ChannelRow): ChannelFormState {
  return {
    channelName: String(channel.channelName ?? ""),
    channelPassword: String(channel.channelPassword ?? ""),
    channelTopic: String(channel.channelTopic ?? ""),
    channelDescription: String(channel.channelDescription ?? ""),
    channelOrder: String(channel.channelOrder ?? "0"),
    channelMaxclients: String(channel.channelMaxclients ?? ""),
    channelFlagMaxclientsUnlimited: toBooleanFlag(
      channel.channelFlagMaxclientsUnlimited,
    ),
    channelType: toBooleanFlag(channel.channelFlagPermanent)
      ? "permanent"
      : toBooleanFlag(channel.channelFlagSemiPermanent)
        ? "semi-permanent"
        : "temporary",
    channelFlagDefault: toBooleanFlag(channel.channelFlagDefault),
    voiceDataEncrypted:
      channel.channelCodecIsUnencrypted === undefined
        ? true
        : !toBooleanFlag(channel.channelCodecIsUnencrypted),
  }
}

function changesFromForm(form: ChannelFormState): ChannelChanges {
  const changes: ChannelChanges = {
    channelName: form.channelName,
    channelPassword: form.channelPassword,
    channelTopic: form.channelTopic,
    channelDescription: form.channelDescription,
    channelOrder: Number(form.channelOrder) || 0,
    channelMaxclients: Number(form.channelMaxclients) || 0,
    channelFlagPermanent: form.channelType === "permanent" ? 1 : 0,
    channelFlagSemiPermanent: form.channelType === "semi-permanent" ? 1 : 0,
    channelFlagDefault: form.channelFlagDefault ? 1 : 0,
    channelCodecIsUnencrypted: form.voiceDataEncrypted ? 0 : 1,
  }

  if (form.channelFlagMaxclientsUnlimited !== null) {
    changes.channelFlagMaxclientsUnlimited = form.channelFlagMaxclientsUnlimited ? 1 : 0
  }

  return changes
}

function changedValues(form: ChannelFormState, initialForm: ChannelFormState) {
  const current = changesFromForm(form)
  const initial = changesFromForm(initialForm)
  const changes: ChannelChanges = {}

  for (const key of Object.keys(current) as Array<keyof ChannelChanges>) {
    if (current[key] !== initial[key]) {
      changes[key] = current[key] as never
    }
  }

  return changes
}

function createValues(form: ChannelFormState) {
  const changes = changedValues(form, defaultForm)

  changes.channelName = form.channelName

  return changes
}

function isTemporaryChannel(form: ChannelFormState) {
  return form.channelType === "temporary"
}

async function getChannelInfo(cid: string) {
  let flight = channelInfoFlights.get(cid)

  if (!flight) {
    flight = TeamSpeak.execute<ChannelRow[]>("channelinfo", { cid })
      .then((channelInfo) => channelInfo[0] ?? ({} as ChannelRow))
      .finally(() => {
        channelInfoFlights.delete(cid)
      })

    channelInfoFlights.set(cid, flight)
  }

  return flight
}

type ChannelOrderOption = {
  label: string
  value: string
}

function ChannelOrderCombobox({
  disabled,
  id,
  onChange,
  options,
  placeholder,
  value,
}: {
  disabled: boolean
  id: string
  onChange: (value: string) => void
  options: ChannelOrderOption[]
  placeholder: string
  value: string
}) {
  const selectedOption = options.find((option) => option.value === value)
  const selectedLabel = selectedOption?.label ?? ""
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [hasUserSelection, setHasUserSelection] = useState(() => value !== "0")

  const showSelectedValue = hasUserSelection && Boolean(selectedLabel)
  const inputValue = open ? query : showSelectedValue ? selectedLabel : ""
  const floating = open || showSelectedValue

  useEffect(() => {
    if (value !== "0") {
      setHasUserSelection(true)
    }
  }, [value])

  useEffect(() => {
    if (!open) {
      setQuery("")
    }
  }, [open])

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) {
      return options
    }

    return options.filter((option) =>
      option.label.toLowerCase().includes(normalizedQuery),
    )
  }, [options, query])

  const selectOption = (option: ChannelOrderOption) => {
    setHasUserSelection(true)
    onChange(option.value)
    setQuery("")
    setOpen(false)
  }

  const openDropdown = () => {
    if (disabled) {
      return
    }

    setQuery("")
    setOpen(true)
  }

  return (
    <div className="relative">
      <div
        className={`relative h-12 rounded-md border bg-background transition-colors ${
          open
            ? "border-ring ring-[3px] ring-ring/50"
            : "border-input hover:border-ring/60"
        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      >
        <label
          className={`pointer-events-none absolute left-3 transition-all ${
            floating
              ? "top-1.5 text-xs text-primary"
              : "top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
          }`}
          htmlFor={id}
        >
          {placeholder}
        </label>

        <input
          aria-label={placeholder}
          className={`h-full w-full bg-transparent px-3 pr-9 text-sm outline-none disabled:cursor-not-allowed ${
            floating ? "pb-1 pt-5" : "pt-0"
          }`}
          disabled={disabled}
          id={id}
          value={inputValue}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120)
          }}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={openDropdown}
          onKeyDown={(event) => {
            if (event.key === "Enter" && open && filteredOptions[0]) {
              event.preventDefault()
              selectOption(filteredOptions[0])
            }

            if (event.key === "Escape") {
              setOpen(false)
            }
          }}
        />

        <button
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          disabled={disabled}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) {
              setOpen(false)
              return
            }

            openDropdown()
          }}
        >
          <ChevronDown
            className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
          <span className="sr-only">Toggle channel order options</span>
        </button>
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover py-1 text-popover-foreground shadow-md">
          {filteredOptions.length ? (
            filteredOptions.map((option) => (
              <button
                className="flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                key={option.value}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
              >
                <span className="truncate">{option.label}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No channels found.
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

export function ChannelForm({ mode }: ChannelFormProps) {
  const navigate = useNavigate()
  const params = useParams()
  const [searchParams] = useSearchParams()
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const queryUserRef = useRef(queryUser)
  const { dismissToast, showError, toasts } = useToastStack()
  const cid = params.cid
  const requestedParentId = searchParams.get("pid") ?? "0"
  const [parentChannelId, setParentChannelId] = useState(requestedParentId)
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [serverInfo, setServerInfo] = useState<ServerInfo>({})
  const [form, setForm] = useState<ChannelFormState>(defaultForm)
  const [initialForm, setInitialForm] = useState<ChannelFormState>(defaultForm)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false)
  const [temporaryWarning, setTemporaryWarning] = useState(false)
  const [pendingChanges, setPendingChanges] = useState<ChannelChanges | null>(null)

  useEffect(() => {
    queryUserRef.current = queryUser
  }, [queryUser])

  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow

    document.documentElement.style.overflow = "hidden"
    document.body.style.overflow = "hidden"

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
    }
  }, [])

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

  const loadPageData = useCallback(async () => {
    if (mode === "edit" && !cid) {
      throw new Error("Channel id is missing.")
    }

    await ensureSelectedServer()

    const key = mode + ":" + (cid ?? "new") + ":" + requestedParentId
    let flight = channelPageDataFlights.get(key)

    if (!flight) {
      flight = (async () => {
        const [channel, nextChannels, serverInfoList] = await Promise.all([
          mode === "edit" && cid
            ? getChannelInfo(cid)
            : Promise.resolve(undefined),
          TeamSpeak.execute<ChannelRow[]>("channellist"),
          TeamSpeak.execute<ServerInfo[]>("serverinfo"),
        ])
        const nextParentId =
          requestedParentId !== "0"
            ? requestedParentId
            : channel?.pid !== undefined
              ? String(channel.pid)
              : "0"

        return {
          channel,
          channels: nextChannels,
          serverInfo: serverInfoList[0] ?? {},
          parentChannelId: nextParentId,
        }
      })().finally(() => {
        channelPageDataFlights.delete(key)
      })

      channelPageDataFlights.set(key, flight)
    }

    return flight
  }, [cid, ensureSelectedServer, mode, requestedParentId])

  useEffect(() => {
    let active = true

    setLoading(true)

    loadPageData()
      .then((data) => {
        if (!active) {
          return
        }

        setChannels(data.channels)
        setServerInfo(data.serverInfo)
        setParentChannelId(data.parentChannelId)

        const nextForm =
          mode === "edit" && data.channel
            ? formFromChannel(data.channel)
            : defaultForm

        setForm(nextForm)
        setInitialForm(nextForm)
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
  }, [loadPageData, mode, showError])

  const channelOrderOptions = useMemo(() => {
    const siblingChannels = channels
      .filter(
        (channel) =>
          String(channel.pid) === String(parentChannelId) &&
          String(channel.cid) !== String(cid ?? ""),
      )
      .map((channel) => ({
        label: channel.channelName,
        value: String(channel.cid),
      }))

    const rootLabel =
      parentChannelId !== "0"
        ? channels.find((channel) => String(channel.cid) === String(parentChannelId))
            ?.channelName
        : serverInfo.virtualserverName

    return [
      { label: rootLabel || "Root", value: "0" },
      ...siblingChannels,
    ]
  }, [channels, cid, parentChannelId, serverInfo.virtualserverName])

  const updateField = <Key extends keyof ChannelFormState>(
    key: Key,
    value: ChannelFormState[Key],
  ) => {
    setForm((currentForm) => ({
      ...currentForm,
      [key]: value,
    }))
  }

  const submitChanges = async (changes: ChannelChanges, action: SaveAction) => {
    await ensureSelectedServer()

    if (mode === "add") {
      await TeamSpeak.execute("channelcreate", {
        ...changes,
        cpid: Number(parentChannelId) || 0,
      })
      navigate(-1)
      return
    }

    if (!cid) {
      throw new Error("Channel id is missing.")
    }

    if (Object.keys(changes).length) {
      await TeamSpeak.execute("channeledit", {
        cid,
        ...changes,
      })
    }

    if (action === "ok") {
      navigate(-1)
      return
    }

    const nextChannel = await getChannelInfo(cid)
    const nextForm = formFromChannel(nextChannel)

    setForm(nextForm)
    setInitialForm(nextForm)
  }

  const saveForm = async (action: SaveAction) => {
    if (!form.channelName.trim()) {
      showError("Name is required.")
      return
    }

    const changes = mode === "add" ? createValues(form) : changedValues(form, initialForm)

    if (mode === "edit" && isTemporaryChannel(form) && !isTemporaryChannel(initialForm)) {
      setPendingChanges(changes)
      setTemporaryWarning(true)
      return
    }

    setSubmitting(true)

    try {
      await submitChanges(changes, action)
    } catch (submitError) {
      showError(getErrorMessage(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void saveForm("ok")
  }

  const confirmTemporarySave = async () => {
    if (!pendingChanges) {
      setTemporaryWarning(false)
      return
    }

    setSubmitting(true)

    try {
      await submitChanges(pendingChanges, "ok")
    } catch (submitError) {
      showError(getErrorMessage(submitError))
      setTemporaryWarning(false)
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
          <CardTitle>{mode === "add" ? "Create Channel" : "Channel Edit"}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              Loading...
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="channelName">Name</Label>
                <Input
                  disabled={busy}
                  id="channelName"
                  required
                  value={form.channelName}
                  onChange={(event) => updateField("channelName", event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="channelPassword">Password</Label>
                <Input
                  disabled={busy}
                  id="channelPassword"
                  type="password"
                  value={form.channelPassword}
                  onChange={(event) =>
                    updateField("channelPassword", event.target.value)
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="channelTopic">Topic</Label>
                <Input
                  disabled={busy}
                  id="channelTopic"
                  value={form.channelTopic}
                  onChange={(event) => updateField("channelTopic", event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="channelDescription">Description</Label>
                <textarea
                  className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={busy}
                  id="channelDescription"
                  value={form.channelDescription}
                  onChange={(event) =>
                    updateField("channelDescription", event.target.value)
                  }
                />
              </div>

              <div className="overflow-hidden rounded-md border">
                <button
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  disabled={busy}
                  type="button"
                  onClick={() => setMoreOptionsOpen((open) => !open)}
                >
                  <span>More Options</span>
                  <ChevronDown
                    className={`size-4 transition-transform ${moreOptionsOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {moreOptionsOpen ? (
                  <div className="space-y-5 border-t p-4">
                    <ChannelOrderCombobox
                      disabled={busy}
                      id="channelOrder"
                      placeholder="Sort This Channel After"
                      options={channelOrderOptions}
                      value={form.channelOrder}
                      onChange={(value) => updateField("channelOrder", value)}
                    />

                    <div className="grid gap-5 md:grid-cols-3">
                      <div className="space-y-3">
                        <Label>Max Users</Label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            checked={form.channelFlagMaxclientsUnlimited === true}
                            disabled={busy}
                            name="max-users"
                            type="radio"
                            onChange={() =>
                              updateField("channelFlagMaxclientsUnlimited", true)
                            }
                          />
                          Unlimited
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            checked={form.channelFlagMaxclientsUnlimited === false}
                            disabled={busy}
                            name="max-users"
                            type="radio"
                            onChange={() =>
                              updateField("channelFlagMaxclientsUnlimited", false)
                            }
                          />
                          Limited
                        </label>
                        <div className="space-y-2">
                          <Label htmlFor="channelMaxclients">Number Of Clients</Label>
                          <Input
                            className="h-10"
                            disabled={busy || form.channelFlagMaxclientsUnlimited === true}
                            id="channelMaxclients"
                            min={0}
                            type="number"
                            value={form.channelMaxclients}
                            onFocus={() => {
                              if (form.channelFlagMaxclientsUnlimited === null) {
                                updateField("channelFlagMaxclientsUnlimited", false)
                              }
                            }}
                            onChange={(event) =>
                              updateField("channelMaxclients", event.target.value)
                            }
                          />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <Label>Channel Type</Label>
                        {(["temporary", "permanent", "semi-permanent"] as const).map(
                          (type) => (
                            <label className="flex items-center gap-2 text-sm" key={type}>
                              <input
                                checked={form.channelType === type}
                                disabled={busy}
                                name="channel-type"
                                type="radio"
                                onChange={() => updateField("channelType", type)}
                              />
                              {type === "semi-permanent"
                                ? "Semi-Permanent"
                                : type[0].toUpperCase() + type.slice(1)}
                            </label>
                          ),
                        )}
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={form.channelFlagDefault}
                            disabled={busy || toBooleanFlag(initialForm.channelFlagDefault)}
                            id="channelDefault"
                            onCheckedChange={(checked) =>
                              updateField("channelFlagDefault", checked === true)
                            }
                          />
                          <Label htmlFor="channelDefault">Default Channel</Label>
                        </div>

                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={form.voiceDataEncrypted}
                            disabled={busy}
                            id="voiceEncrypted"
                            onCheckedChange={(checked) =>
                              updateField("voiceDataEncrypted", checked === true)
                            }
                          />
                          <Label htmlFor="voiceEncrypted">Voice Data encrypted</Label>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

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

                {mode === "edit" ? (
                  <Button
                    disabled={busy}
                    type="button"
                    variant="outline"
                    onClick={() => void saveForm("apply")}
                  >
                    {submitting ? "SAVING..." : "Apply"}
                  </Button>
                ) : null}

              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <AppModal
        open={temporaryWarning}
        preventClose={submitting}
        title="Temporary Channel"
        footer={
          <>
            <Button
              disabled={submitting}
              type="button"
              variant="outline"
              onClick={() => setTemporaryWarning(false)}
            >
              No
            </Button>
            <Button
              disabled={submitting}
              type="button"
              onClick={() => void confirmTemporarySave()}
            >
              {submitting ? "Saving..." : "Yes"}
            </Button>
          </>
        }
        onClose={() => setTemporaryWarning(false)}
      >
        <p className="text-sm text-muted-foreground">
          If there are no clients inside the channel and you change it to
          temporary, the channel will be deleted. Do you want to continue?
        </p>
      </AppModal>
    </div>
  )
}
