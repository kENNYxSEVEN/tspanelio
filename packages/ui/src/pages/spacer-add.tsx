import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"
import { useNavigate } from "react-router-dom"
import { ChevronDown } from "lucide-react"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth } from "@/auth/auth-context"
import { ToastStack, useToastStack } from "@/components/toast-stack"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type SpacerAlignment = "" | "l" | "c" | "r"

type ChannelType = "temporary" | "permanent" | "semi-permanent"

type SpacerForm = {
  specialSpacer: string
  spacerAlignment: SpacerAlignment
  spacerText: string
  channelPassword: string
  channelTopic: string
  channelDescription: string
  channelOrder: string
  channelMaxclients: string
  channelFlagMaxclientsUnlimited: boolean | null
  channelType: ChannelType
  channelFlagDefault: boolean
  voiceDataEncrypted: boolean
}

type ChannelRow = {
  cid: string | number
  pid: string | number
  channelName: string
  [key: string]: unknown
}

type ServerInfo = {
  virtualserverName?: string
  [key: string]: unknown
}

type SelectOption = {
  label: string
  value: string
}

const spacerPageDataFlights = new Map<
  string,
  Promise<{ channels: ChannelRow[]; serverInfo: ServerInfo }>
>()

const defaultForm: SpacerForm = {
  specialSpacer: "",
  spacerAlignment: "",
  spacerText: "",
  channelPassword: "",
  channelTopic: "",
  channelDescription: "",
  channelOrder: "0",
  channelMaxclients: "",
  channelFlagMaxclientsUnlimited: null,
  channelType: "permanent",
  channelFlagDefault: false,
  voiceDataEncrypted: false,
}

const specialSpacerList: SelectOption[] = [
  { label: "", value: "" },
  { label: "---", value: "---" },
  { label: "...", value: "..." },
  { label: "-.-", value: "-.-" },
  { label: "___", value: "___" },
  { label: "-..", value: "-.." },
]

const spacerAlignmentList: SelectOption[] = [
  { label: "", value: "" },
  { label: "left", value: "l" },
  { label: "center", value: "c" },
  { label: "right", value: "r" },
]

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

function buildSpacerName(form: SpacerForm) {
  const randomId = Math.floor(Math.random() * 100)

  return `[${form.spacerAlignment}spacer${randomId}]${
    form.specialSpacer || form.spacerText
  }`
}

function buildSpacerPayload(form: SpacerForm) {
  const payload: Record<string, unknown> = {
    channelName: buildSpacerName(form),
    channelFlagPermanent: form.channelType === "permanent" ? 1 : 0,
    channelFlagSemiPermanent: form.channelType === "semi-permanent" ? 1 : 0,
  }

  if (form.channelPassword) {
    payload.channelPassword = form.channelPassword
  }

  if (form.channelTopic) {
    payload.channelTopic = form.channelTopic
  }

  if (form.channelDescription) {
    payload.channelDescription = form.channelDescription
  }

  if (form.channelOrder !== "0") {
    payload.channelOrder = Number(form.channelOrder) || 0
  }

  if (form.channelMaxclients.trim()) {
    payload.channelMaxclients = Number(form.channelMaxclients) || 0
  }

  if (form.channelFlagMaxclientsUnlimited !== null) {
    payload.channelFlagMaxclientsUnlimited = form.channelFlagMaxclientsUnlimited ? 1 : 0
  }

  if (form.channelFlagDefault) {
    payload.channelFlagDefault = 1
  }

  if (form.voiceDataEncrypted) {
    payload.channelCodecIsUnencrypted = 0
  }

  return payload
}

function SimpleSelect({
  disabled,
  id,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean
  id: string
  label: string
  onChange: (value: string) => void
  options: SelectOption[]
  value: string
}) {
  const selectedOption = options.find((option) => option.value === value)
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <Label className="mb-2 block" htmlFor={id}>
        {label}
      </Label>
      <button
        className="flex h-10 w-full items-center justify-between rounded-md border bg-background px-3 text-left text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        id={id}
        type="button"
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120)
        }}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="truncate">{selectedOption?.label ?? ""}</span>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover py-1 text-popover-foreground shadow-md">
          {options.map((option) => (
            <button
              className="flex min-h-10 w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              key={option.value || "empty"}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              <span className="truncate">{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
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
  options: SelectOption[]
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

  const selectOption = (option: SelectOption) => {
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

export function SpacerAdd() {
  const navigate = useNavigate()
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const queryUserRef = useRef(queryUser)
  const { dismissToast, showError, toasts } = useToastStack()
  const [form, setForm] = useState(defaultForm)
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [serverInfo, setServerInfo] = useState<ServerInfo>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false)

  useEffect(() => {
    queryUserRef.current = queryUser
  }, [queryUser])

  const ensureSelectedServer = useCallback(async () => {
    const selectedServerId = isUsableServerId(queryUserRef.current.virtualserverId)
      ? queryUserRef.current.virtualserverId
      : serverId

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
  }, [saveQueryUser, saveServerId, serverId])

  const loadPageData = useCallback(async () => {
    await ensureSelectedServer()

    const key = String(queryUserRef.current.virtualserverId ?? serverId ?? "default")
    let flight = spacerPageDataFlights.get(key)

    if (!flight) {
      flight = Promise.all([
        TeamSpeak.execute<ChannelRow[]>("channellist"),
        TeamSpeak.execute<ServerInfo[]>("serverinfo"),
      ])
        .then(([nextChannels, serverInfoList]) => ({
          channels: nextChannels,
          serverInfo: serverInfoList[0] ?? {},
        }))
        .finally(() => {
          spacerPageDataFlights.delete(key)
        })

      spacerPageDataFlights.set(key, flight)
    }

    return flight
  }, [ensureSelectedServer, serverId])

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
  }, [loadPageData, showError])

  const channelOrderOptions = useMemo(() => {
    const rootLabel = serverInfo.virtualserverName || "Root"

    return [
      { label: rootLabel, value: "0" },
      ...channels.map((channel) => ({
        label: channel.channelName,
        value: String(channel.cid),
      })),
    ]
  }, [channels, serverInfo.virtualserverName])

  const updateField = <Key extends keyof SpacerForm>(
    key: Key,
    value: SpacerForm[Key],
  ) => {
    setForm((currentForm) => ({
      ...currentForm,
      [key]: value,
    }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setSubmitting(true)

    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("channelcreate", buildSpacerPayload(form))
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
          <CardTitle>Create Spacer</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              Loading...
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <SimpleSelect
                disabled={busy || Boolean(form.spacerAlignment || form.spacerText)}
                id="specialSpacer"
                label="Special Spacer"
                options={specialSpacerList}
                value={form.specialSpacer}
                onChange={(value) => updateField("specialSpacer", value)}
              />

              <div className="grid items-start gap-4 sm:grid-cols-2">
                <SimpleSelect
                  disabled={busy || Boolean(form.specialSpacer)}
                  id="spacerAlignment"
                  label="Alignment"
                  options={spacerAlignmentList}
                  value={form.spacerAlignment}
                  onChange={(value) =>
                    updateField("spacerAlignment", value as SpacerAlignment)
                  }
                />

                <div className="space-y-2">
                  <Label htmlFor="spacerText">Text</Label>
                  <Input
                    className="h-10"
                    disabled={busy || Boolean(form.specialSpacer)}
                    id="spacerText"
                    value={form.spacerText}
                    onChange={(event) => updateField("spacerText", event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="channelPassword">Password</Label>
                <Input
                  className="h-10"
                  disabled={busy}
                  id="channelPassword"
                  type="password"
                  value={form.channelPassword}
                  onChange={(event) => updateField("channelPassword", event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="channelTopic">Topic</Label>
                <Input
                  className="h-10"
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
                            disabled={busy}
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
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
