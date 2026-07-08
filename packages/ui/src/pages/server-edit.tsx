import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { useNavigate } from "react-router-dom"
import { ChevronDown } from "lucide-react"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth } from "@/auth/auth-context"
import { AppSelect, type AppSelectOption } from "@/components/app-select"
import { ToastStack, useToastStack } from "@/components/toast-stack"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type ServerInfoValue = string | number | boolean | null | undefined
type ServerInfo = Record<string, ServerInfoValue>
type ServerGroup = {
  name: string
  sgid: string | number
  type: string | number
}
type ChannelGroup = {
  cgid: string | number
  name: string
  type: string | number
}

type ServerEditData = {
  channelGroups: ChannelGroup[]
  serverGroups: ServerGroup[]
  serverInfo: ServerInfo
}

type PayloadValue = string | number

const textFields = [
  "virtualserverName",
  "virtualserverPassword",
  "virtualserverWelcomemessage",
  "virtualserverHostmessage",
  "virtualserverHostbannerGfxUrl",
  "virtualserverHostbannerUrl",
  "virtualserverHostbuttonTooltip",
  "virtualserverHostbuttonUrl",
  "virtualserverHostbuttonGfxUrl",
  "virtualserverNamePhonetic",
] as const

const numberFields = [
  "virtualserverMaxclients",
  "virtualserverReservedSlots",
  "virtualserverHostbannerGfxInterval",
  "virtualserverMaxUploadTotalBandwidth",
  "virtualserverUploadQuota",
  "virtualserverMaxDownloadTotalBandwidth",
  "virtualserverDownloadQuota",
  "virtualserverAntifloodPointsTickReduce",
  "virtualserverAntifloodPointsNeededCommandBlock",
  "virtualserverAntifloodPointsNeededIpBlock",
  "virtualserverNeededIdentitySecurityLevel",
  "virtualserverComplainAutobanCount",
  "virtualserverComplainAutobanTime",
  "virtualserverComplainRemoveTime",
  "virtualserverMinClientsInChannelBeforeForcedSilence",
  "virtualserverPrioritySpeakerDimmModificator",
  "virtualserverChannelTempDeleteDelayDefault",
] as const

const selectFields = [
  "virtualserverHostmessageMode",
  "virtualserverHostbannerMode",
  "virtualserverCodecEncryptionMode",
  "virtualserverDefaultServerGroup",
  "virtualserverDefaultChannelGroup",
  "virtualserverDefaultChannelAdminGroup",
] as const

const checkboxFields = [
  "virtualserverWeblistEnabled",
  "virtualserverLogClient",
  "virtualserverLogChannel",
  "virtualserverLogServer",
  "virtualserverLogQuery",
  "virtualserverLogPermissions",
  "virtualserverLogFiletransfer",
] as const

const formFields = [
  ...textFields,
  ...numberFields,
  ...selectFields,
  ...checkboxFields,
] as const

type ServerEditField = (typeof formFields)[number]
type ServerEditForm = Record<ServerEditField, string>

const legacyFieldNames: Partial<Record<ServerEditField, string>> = {
  virtualserverAntifloodPointsNeededCommandBlock:
    "virtualserverAntifloodPointsNeededCommand_block",
  virtualserverAntifloodPointsNeededIpBlock:
    "virtualserverAntifloodPointsNeededIp_block",
  virtualserverChannelTempDeleteDelayDefault:
    "virtualserverChannelTempDeleteDelay_default",
  virtualserverMinClientsInChannelBeforeForcedSilence:
    "virtualserverMinClientsInChannel_beforeForcedSilence",
}

const messageModeOptions = [
  { label: "No message", value: "0" },
  { label: "Show message in log", value: "1" },
  { label: "Show modal message", value: "2" },
  { label: "Modal message and exit", value: "3" },
]

const bannerModeOptions = [
  { label: "Do not adjust", value: "0" },
  { label: "Adjust but ignore aspect ratio", value: "1" },
  { label: "Adjust and keep aspect ratio", value: "2" },
]

const encryptionModeOptions = [
  { label: "Configure per Channel", value: "0" },
  { label: "Globally Off", value: "1" },
  { label: "Globally On", value: "2" },
]

const emptyForm = formFields.reduce((form, field) => {
  form[field] = checkboxFields.includes(field as (typeof checkboxFields)[number])
    ? "0"
    : ""

  return form
}, {} as ServerEditForm)

const serverEditFlights = new Map<string, Promise<ServerEditData>>()

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

function getServerInfoValue(serverInfo: ServerInfo, field: ServerEditField) {
  const legacyFieldName = legacyFieldNames[field]

  return serverInfo[field] ?? (legacyFieldName ? serverInfo[legacyFieldName] : undefined)
}

function isCheckedValue(value: ServerInfoValue) {
  return value === true || value === 1 || value === "1" || value === "true"
}

function toForm(serverInfo: ServerInfo): ServerEditForm {
  const nextForm = { ...emptyForm }

  for (const field of formFields) {
    const value = getServerInfoValue(serverInfo, field)

    if (checkboxFields.includes(field as (typeof checkboxFields)[number])) {
      nextForm[field] = isCheckedValue(value) ? "1" : "0"
      continue
    }

    nextForm[field] = value === undefined || value === null ? "" : String(value)
  }

  return nextForm
}

function isNumericPayloadField(field: ServerEditField) {
  return (
    numberFields.includes(field as (typeof numberFields)[number]) ||
    selectFields.includes(field as (typeof selectFields)[number])
  )
}

function toPayloadValue(field: ServerEditField, value: string): PayloadValue {
  if (checkboxFields.includes(field as (typeof checkboxFields)[number])) {
    return value === "1" ? 1 : 0
  }

  if (isNumericPayloadField(field) && value.trim() !== "") {
    const numericValue = Number(value)

    return Number.isFinite(numericValue) ? numericValue : value
  }

  return value
}

function buildChangedFields(form: ServerEditForm, initialForm: ServerEditForm) {
  return formFields.reduce<Record<string, PayloadValue>>((changes, field) => {
    const nextValue = toPayloadValue(field, form[field])
    const initialValue = toPayloadValue(field, initialForm[field])

    if (String(nextValue) !== String(initialValue)) {
      changes[legacyFieldNames[field] ?? field] = nextValue
    }

    return changes
  }, {})
}

function normalizeServerGroups(groups: ServerGroup[]) {
  return groups.filter((group) => Number(group.type) === 1)
}

function normalizeChannelGroups(groups: ChannelGroup[]) {
  return groups.filter((group) => Number(group.type) === 1)
}

async function loadServerEditData(serverId: string) {
  const existingFlight = serverEditFlights.get(serverId)

  if (existingFlight) {
    return existingFlight
  }

  const flight = Promise.all([
    TeamSpeak.execute<ServerInfo[]>("serverinfo", {}, [], { progress: "background" }),
    TeamSpeak.execute<ServerGroup[]>("servergrouplist", {}, [], {
      progress: "background",
    }),
    TeamSpeak.execute<ChannelGroup[]>("channelgrouplist", {}, [], {
      progress: "background",
    }),
  ])
    .then(([serverInfo, serverGroups, channelGroups]) => ({
      channelGroups: normalizeChannelGroups(channelGroups),
      serverGroups: normalizeServerGroups(serverGroups),
      serverInfo: serverInfo[0] ?? {},
    }))
    .finally(() => {
      serverEditFlights.delete(serverId)
    })

  serverEditFlights.set(serverId, flight)

  return flight
}

function getOptionsWithCurrent(
  options: AppSelectOption[],
  currentValue: string,
  fallbackLabel: string,
) {
  if (!currentValue || options.some((option) => option.value === currentValue)) {
    return options
  }

  return [{ label: `${fallbackLabel} (${currentValue})`, value: currentValue }, ...options]
}

function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2">{children}</div>
}

function BasicGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2">{children}</div>
}

type CollapsibleSectionKey =
  | "host"
  | "transfers"
  | "antiFlood"
  | "security"
  | "misc"
  | "logs"

function CollapsibleSection({
  children,
  id,
  open,
  title,
  onToggle,
}: {
  children: ReactNode
  id: CollapsibleSectionKey
  open: boolean
  title: string
  onToggle: (section: CollapsibleSectionKey) => void
}) {
  const [rendered, setRendered] = useState(open)
  const [height, setHeight] = useState<number | "auto">(open ? "auto" : 0)
  const [visible, setVisible] = useState(open)
  const contentRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }

    if (open) {
      setRendered(true)
      setVisible(false)
      setHeight(0)

      frameRef.current = window.requestAnimationFrame(() => {
        setHeight(contentRef.current?.scrollHeight ?? 0)
        setVisible(true)
        frameRef.current = null
      })

      return () => {
        if (frameRef.current !== null) {
          window.cancelAnimationFrame(frameRef.current)
          frameRef.current = null
        }
      }
    }

    if (rendered) {
      setVisible(false)
      setHeight(contentRef.current?.scrollHeight ?? 0)

      frameRef.current = window.requestAnimationFrame(() => {
        setHeight(0)
        frameRef.current = null
      })
    }

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [open, rendered])

  return (
    <section className="border-t">
      <button
        aria-controls={`server-edit-${id}`}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-0 py-4 text-left text-sm font-medium"
        type="button"
        onClick={() => onToggle(id)}
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform duration-300 ease-in-out",
            open && "rotate-180",
          )}
        />
      </button>

      <div
        id={`server-edit-${id}`}
        className="overflow-hidden transition-[height] duration-300 ease-in-out"
        style={{ height: rendered ? height : 0 }}
        onTransitionEnd={(event) => {
          if (
            event.currentTarget !== event.target ||
            event.propertyName !== "height"
          ) {
            return
          }

          if (open) {
            setHeight("auto")
            return
          }

          setRendered(false)
        }}
      >
        {rendered ? (
          <div
            ref={contentRef}
            className={cn(
              "space-y-3 pb-5 transition-[opacity,transform] duration-300 ease-in-out",
              visible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
            )}
          >
            {children}
          </div>
        ) : null}
      </div>
    </section>
  )
}


function SubSection({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <div className="space-y-4 rounded-lg border bg-muted/10 p-4">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

function TextField({
  disabled,
  field,
  label,
  onChange,
  type = "text",
  value,
}: {
  disabled: boolean
  field: ServerEditField
  label: string
  onChange: (field: ServerEditField, value: string) => void
  type?: "number" | "password" | "text"
  value: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={field}>{label}</Label>
      <Input
        disabled={disabled}
        id={field}
        inputMode={type === "number" ? "numeric" : undefined}
        type={type}
        value={value}
        onChange={(event) => onChange(field, event.target.value)}
      />
    </div>
  )
}

function UnitField({
  disabled,
  field,
  label,
  onChange,
  unit,
  value,
}: {
  disabled: boolean
  field: ServerEditField
  label: string
  onChange: (field: ServerEditField, value: string) => void
  unit: string
  value: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={field}>{label}</Label>
      <div className="relative">
        <Input
          className="pr-16"
          disabled={disabled}
          id={field}
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(field, event.target.value)}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
  )
}

function TextAreaField({
  disabled,
  field,
  label,
  onChange,
  value,
}: {
  disabled: boolean
  field: ServerEditField
  label: string
  onChange: (field: ServerEditField, value: string) => void
  value: string
}) {
  return (
    <div className="space-y-2 md:col-span-2">
      <Label htmlFor={field}>{label}</Label>
      <textarea
        className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        id={field}
        value={value}
        onChange={(event) => onChange(field, event.target.value)}
      />
    </div>
  )
}

function ChoiceField({
  disabled,
  field,
  label,
  onChange,
  options,
  value,
}: {
  disabled: boolean
  field: ServerEditField
  label: string
  onChange: (field: ServerEditField, value: string) => void
  options: AppSelectOption[]
  value: string
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <AppSelect
        disabled={disabled}
        value={value}
        options={options}
        onChange={(nextValue) => onChange(field, nextValue)}
      />
    </div>
  )
}

function CheckboxField({
  disabled,
  field,
  label,
  onChange,
  value,
}: {
  disabled: boolean
  field: ServerEditField
  label: string
  onChange: (field: ServerEditField, value: string) => void
  value: string
}) {
  return (
    <label className="flex min-h-10 items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm">
      <Checkbox
        checked={value === "1"}
        disabled={disabled}
        onCheckedChange={(checked) => onChange(field, checked === true ? "1" : "0")}
      />
      <span>{label}</span>
    </label>
  )
}

export function ServerEdit() {
  const navigate = useNavigate()
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const { dismissToast, showError, showInfo, showSuccess, toasts } =
    useToastStack()
  const [form, setForm] = useState<ServerEditForm>(emptyForm)
  const [initialForm, setInitialForm] = useState<ServerEditForm>(emptyForm)
  const [serverGroups, setServerGroups] = useState<ServerGroup[]>([])
  const [channelGroups, setChannelGroups] = useState<ChannelGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openSection, setOpenSection] = useState<CollapsibleSectionKey | null>(null)
  const loadedServerIdRef = useRef<string | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)

  const selectedServerId = useMemo(() => {
    if (isUsableServerId(queryUser.virtualserverId)) {
      return String(queryUser.virtualserverId)
    }

    if (isUsableServerId(serverId)) {
      return String(serverId)
    }

    return undefined
  }, [queryUser.virtualserverId, serverId])

  const disabled = loading || saving
  const changedFields = useMemo(
    () => buildChangedFields(form, initialForm),
    [form, initialForm],
  )
  const hasChanges = Object.keys(changedFields).length > 0

  const serverGroupOptions = useMemo(
    () =>
      serverGroups.map((group) => ({
        label: `${group.name} (${group.sgid})`,
        value: String(group.sgid),
      })),
    [serverGroups],
  )

  const channelGroupOptions = useMemo(
    () =>
      channelGroups.map((group) => ({
        label: `${group.name} (${group.cgid})`,
        value: String(group.cgid),
      })),
    [channelGroups],
  )

  const updateField = useCallback((field: ServerEditField, value: string) => {
    setForm((currentForm) => ({ ...currentForm, [field]: value }))
  }, [])

  const toggleSection = useCallback((section: CollapsibleSectionKey) => {
    setOpenSection((currentSection) =>
      currentSection === section ? null : section,
    )
  }, [])

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

  const loadPage = useCallback(
    async ({ foreground = false }: { foreground?: boolean } = {}) => {
      if (!selectedServerId) {
        setLoading(false)
        setError("Select an online virtual server from Server List first.")
        return
      }

      setLoading(true)
      setError(null)

      try {
        await TeamSpeak.useServer(selectedServerId, {
          progress: foreground ? "foreground" : "background",
        })
        saveServerId(selectedServerId)

        const nextQueryUser = await TeamSpeak.ensureQueryIdentity({
          progress: "background",
        })

        if (nextQueryUser) {
          saveQueryUser(nextQueryUser)
        }

        const data = await loadServerEditData(selectedServerId)
        const nextForm = toForm(data.serverInfo)

        setForm(nextForm)
        setInitialForm(nextForm)
        setServerGroups(data.serverGroups)
        setChannelGroups(data.channelGroups)
        loadedServerIdRef.current = selectedServerId
      } catch (loadError) {
        const message = getErrorMessage(loadError)

        setError(message)
        showError(message)
      } finally {
        setLoading(false)
      }
    },
    [saveQueryUser, saveServerId, selectedServerId, showError],
  )

  useEffect(() => {
    if (loadedServerIdRef.current === selectedServerId) {
      return
    }

    void loadPage()
  }, [loadPage, selectedServerId])

  const saveChanges = async ({ leaveAfterSave }: { leaveAfterSave: boolean }) => {
    if (!selectedServerId) {
      const message = "Select an online virtual server from Server List first."

      setError(message)
      showError(message)
      return
    }

    if (!hasChanges) {
      if (leaveAfterSave) {
        navigate(-1)
        return
      }

      showInfo("No changes to save.")
      return
    }

    setSaving(true)
    setError(null)

    try {
      await TeamSpeak.useServer(selectedServerId, { progress: "background" })
      await TeamSpeak.execute("serveredit", changedFields, [], {
        progress: "foreground",
      })
      showSuccess("Server updated")

      if (leaveAfterSave) {
        navigate(-1)
        return
      }

      await loadPage({ foreground: false })
    } catch (saveError) {
      const message = getErrorMessage(saveError)

      setError(message)
      showError(message)
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void saveChanges({ leaveAfterSave: true })
  }

  if (!selectedServerId && !loading) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>No server selected</CardTitle>
            <CardDescription>
              Select an online virtual server from Server List first.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex-wrap justify-end gap-2 max-sm:[&>*]:w-full">
            <Button type="button" variant="outline" onClick={() => navigate("/servers")}>
              Back to Servers
            </Button>
          </CardFooter>
        </Card>
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </div>
    )
  }

  return (
    <div ref={pageRef} className="mx-auto w-full max-w-3xl">
      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader className="pb-5">
            <CardTitle>Manage Virtual Server</CardTitle>
          </CardHeader>

          <CardContent>
            {error ? (
              <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            {loading ? (
              <div className="rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
                Loading server settings...
              </div>
            ) : (
              <div className="space-y-5">
                <BasicGrid>
                  <div className="md:col-span-2">
                    <TextField
                      disabled={disabled}
                      field="virtualserverName"
                      label="Server Name"
                      value={form.virtualserverName}
                      onChange={updateField}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <TextField
                      disabled={disabled}
                      field="virtualserverPassword"
                      label="Password"
                      type="password"
                      value={form.virtualserverPassword}
                      onChange={updateField}
                    />
                  </div>

                  <TextField
                    disabled={disabled}
                    field="virtualserverMaxclients"
                    label="Maximum Clients"
                    type="number"
                    value={form.virtualserverMaxclients}
                    onChange={updateField}
                  />

                  <TextField
                    disabled={disabled}
                    field="virtualserverReservedSlots"
                    label="Reserved Slots"
                    type="number"
                    value={form.virtualserverReservedSlots}
                    onChange={updateField}
                  />

                  <TextAreaField
                    disabled={disabled}
                    field="virtualserverWelcomemessage"
                    label="Welcome Message"
                    value={form.virtualserverWelcomemessage}
                    onChange={updateField}
                  />
                </BasicGrid>

                <div>
                  <CollapsibleSection
                    id="host"
                    open={openSection === "host"}
                    title="Host"
                    onToggle={toggleSection}
                  >
                    <SubSection title="Host Message">
                      <FieldGrid>
                        <TextAreaField
                          disabled={disabled}
                          field="virtualserverHostmessage"
                          label="Message"
                          value={form.virtualserverHostmessage}
                          onChange={updateField}
                        />

                        <ChoiceField
                          disabled={disabled}
                          field="virtualserverHostmessageMode"
                          label="Message Mode"
                          options={messageModeOptions}
                          value={form.virtualserverHostmessageMode}
                          onChange={updateField}
                        />
                      </FieldGrid>
                    </SubSection>

                    <SubSection title="Host Banner">
                      <FieldGrid>
                        <div className="md:col-span-2">
                          <TextField
                            disabled={disabled}
                            field="virtualserverHostbannerGfxUrl"
                            label="Banner Gfx URL"
                            value={form.virtualserverHostbannerGfxUrl}
                            onChange={updateField}
                          />
                        </div>

                        <div className="md:col-span-2">
                          <TextField
                            disabled={disabled}
                            field="virtualserverHostbannerUrl"
                            label="URL"
                            value={form.virtualserverHostbannerUrl}
                            onChange={updateField}
                          />
                        </div>

                        <TextField
                          disabled={disabled}
                          field="virtualserverHostbannerGfxInterval"
                          label="Gfx Interval"
                          type="number"
                          value={form.virtualserverHostbannerGfxInterval}
                          onChange={updateField}
                        />

                        <ChoiceField
                          disabled={disabled}
                          field="virtualserverHostbannerMode"
                          label="Resize"
                          options={bannerModeOptions}
                          value={form.virtualserverHostbannerMode}
                          onChange={updateField}
                        />
                      </FieldGrid>
                    </SubSection>

                    <SubSection title="Host Button">
                      <FieldGrid>
                        <div className="md:col-span-2">
                          <TextField
                            disabled={disabled}
                            field="virtualserverHostbuttonTooltip"
                            label="Tooltip"
                            value={form.virtualserverHostbuttonTooltip}
                            onChange={updateField}
                          />
                        </div>

                        <div className="md:col-span-2">
                          <TextField
                            disabled={disabled}
                            field="virtualserverHostbuttonUrl"
                            label="URL"
                            value={form.virtualserverHostbuttonUrl}
                            onChange={updateField}
                          />
                        </div>

                        <div className="md:col-span-2">
                          <TextField
                            disabled={disabled}
                            field="virtualserverHostbuttonGfxUrl"
                            label="Icon URL"
                            value={form.virtualserverHostbuttonGfxUrl}
                            onChange={updateField}
                          />
                        </div>
                      </FieldGrid>
                    </SubSection>
                  </CollapsibleSection>

                  <CollapsibleSection
                    id="transfers"
                    open={openSection === "transfers"}
                    title="Transfers"
                    onToggle={toggleSection}
                  >
                    <SubSection title="Upload">
                      <div className="space-y-4">
                        <UnitField
                          disabled={disabled}
                          field="virtualserverMaxUploadTotalBandwidth"
                          label="Bandwidth Limit"
                          unit="Byte/s"
                          value={form.virtualserverMaxUploadTotalBandwidth}
                          onChange={updateField}
                        />

                        <UnitField
                          disabled={disabled}
                          field="virtualserverUploadQuota"
                          label="Upload Quota"
                          unit="MiB"
                          value={form.virtualserverUploadQuota}
                          onChange={updateField}
                        />
                      </div>
                    </SubSection>

                    <SubSection title="Download">
                      <div className="space-y-4">
                        <UnitField
                          disabled={disabled}
                          field="virtualserverMaxDownloadTotalBandwidth"
                          label="Bandwidth Limit"
                          unit="Byte/s"
                          value={form.virtualserverMaxDownloadTotalBandwidth}
                          onChange={updateField}
                        />

                        <UnitField
                          disabled={disabled}
                          field="virtualserverDownloadQuota"
                          label="Download Quota"
                          unit="MiB"
                          value={form.virtualserverDownloadQuota}
                          onChange={updateField}
                        />
                      </div>
                    </SubSection>
                  </CollapsibleSection>

                  <CollapsibleSection
                    id="antiFlood"
                    open={openSection === "antiFlood"}
                    title="Anti-Flood"
                    onToggle={toggleSection}
                  >
                    <SubSection title="Anti-Flood">
                      <div className="space-y-4">
                        <TextField
                          disabled={disabled}
                          field="virtualserverAntifloodPointsTickReduce"
                          label="Reduced point per tick"
                          type="number"
                          value={form.virtualserverAntifloodPointsTickReduce}
                          onChange={updateField}
                        />

                        <TextField
                          disabled={disabled}
                          field="virtualserverAntifloodPointsNeededCommandBlock"
                          label="Points needed to block commands"
                          type="number"
                          value={form.virtualserverAntifloodPointsNeededCommandBlock}
                          onChange={updateField}
                        />

                        <TextField
                          disabled={disabled}
                          field="virtualserverAntifloodPointsNeededIpBlock"
                          label="Points needed to block IP"
                          type="number"
                          value={form.virtualserverAntifloodPointsNeededIpBlock}
                          onChange={updateField}
                        />
                      </div>
                    </SubSection>
                  </CollapsibleSection>

                  <CollapsibleSection
                    id="security"
                    open={openSection === "security"}
                    title="Security"
                    onToggle={toggleSection}
                  >
                    <SubSection title="Security">
                      <div className="space-y-4">
                        <TextField
                          disabled={disabled}
                          field="virtualserverNeededIdentitySecurityLevel"
                          label="Needed Security Level"
                          type="number"
                          value={form.virtualserverNeededIdentitySecurityLevel}
                          onChange={updateField}
                        />

                        <ChoiceField
                          disabled={disabled}
                          field="virtualserverCodecEncryptionMode"
                          label="Channel voice data encryption"
                          options={encryptionModeOptions}
                          value={form.virtualserverCodecEncryptionMode}
                          onChange={updateField}
                        />
                      </div>
                    </SubSection>
                  </CollapsibleSection>

                  <CollapsibleSection
                    id="misc"
                    open={openSection === "misc"}
                    title="Misc"
                    onToggle={toggleSection}
                  >
                    <SubSection title="Default Groups">
                      <div className="space-y-4">
                        <ChoiceField
                          disabled={disabled}
                          field="virtualserverDefaultServerGroup"
                          label="Server Group"
                          options={getOptionsWithCurrent(
                            serverGroupOptions,
                            form.virtualserverDefaultServerGroup,
                            "Server Group",
                          )}
                          value={form.virtualserverDefaultServerGroup}
                          onChange={updateField}
                        />

                        <ChoiceField
                          disabled={disabled}
                          field="virtualserverDefaultChannelGroup"
                          label="Channel Group"
                          options={getOptionsWithCurrent(
                            channelGroupOptions,
                            form.virtualserverDefaultChannelGroup,
                            "Channel Group",
                          )}
                          value={form.virtualserverDefaultChannelGroup}
                          onChange={updateField}
                        />

                        <ChoiceField
                          disabled={disabled}
                          field="virtualserverDefaultChannelAdminGroup"
                          label="Channel Admin Group"
                          options={getOptionsWithCurrent(
                            channelGroupOptions,
                            form.virtualserverDefaultChannelAdminGroup,
                            "Channel Group",
                          )}
                          value={form.virtualserverDefaultChannelAdminGroup}
                          onChange={updateField}
                        />
                      </div>
                    </SubSection>

                    <SubSection title="Complain">
                      <div className="grid gap-4 md:grid-cols-3">
                        <TextField
                          disabled={disabled}
                          field="virtualserverComplainAutobanCount"
                          label="Autoban Count"
                          type="number"
                          value={form.virtualserverComplainAutobanCount}
                          onChange={updateField}
                        />

                        <UnitField
                          disabled={disabled}
                          field="virtualserverComplainAutobanTime"
                          label="Autoban Time"
                          unit="sec"
                          value={form.virtualserverComplainAutobanTime}
                          onChange={updateField}
                        />

                        <UnitField
                          disabled={disabled}
                          field="virtualserverComplainRemoveTime"
                          label="Remove Time"
                          unit="sec"
                          value={form.virtualserverComplainRemoveTime}
                          onChange={updateField}
                        />
                      </div>
                    </SubSection>

                    <SubSection title="Other">
                      <div className="space-y-4">
                        <TextField
                          disabled={disabled}
                          field="virtualserverMinClientsInChannelBeforeForcedSilence"
                          label="Min clients in channel before silence"
                          type="number"
                          value={form.virtualserverMinClientsInChannelBeforeForcedSilence}
                          onChange={updateField}
                        />

                        <TextField
                          disabled={disabled}
                          field="virtualserverPrioritySpeakerDimmModificator"
                          label="Priority Speaker dim modificator"
                          type="number"
                          value={form.virtualserverPrioritySpeakerDimmModificator}
                          onChange={updateField}
                        />

                        <TextField
                          disabled={disabled}
                          field="virtualserverChannelTempDeleteDelayDefault"
                          label="Delete delay for temporary channel"
                          type="number"
                          value={form.virtualserverChannelTempDeleteDelayDefault}
                          onChange={updateField}
                        />

                        <TextField
                          disabled={disabled}
                          field="virtualserverNamePhonetic"
                          label="Phonetic Name"
                          value={form.virtualserverNamePhonetic}
                          onChange={updateField}
                        />

                        <CheckboxField
                          disabled={disabled}
                          field="virtualserverWeblistEnabled"
                          label="Enable reporting to serverlist"
                          value={form.virtualserverWeblistEnabled}
                          onChange={updateField}
                        />
                      </div>
                    </SubSection>
                  </CollapsibleSection>

                  <CollapsibleSection
                    id="logs"
                    open={openSection === "logs"}
                    title="Logs"
                    onToggle={toggleSection}
                  >
                    <SubSection title="Enable Logging For">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <CheckboxField
                          disabled={disabled}
                          field="virtualserverLogClient"
                          label="Clients"
                          value={form.virtualserverLogClient}
                          onChange={updateField}
                        />
                        <CheckboxField
                          disabled={disabled}
                          field="virtualserverLogChannel"
                          label="Channel"
                          value={form.virtualserverLogChannel}
                          onChange={updateField}
                        />
                        <CheckboxField
                          disabled={disabled}
                          field="virtualserverLogServer"
                          label="Server"
                          value={form.virtualserverLogServer}
                          onChange={updateField}
                        />
                        <CheckboxField
                          disabled={disabled}
                          field="virtualserverLogQuery"
                          label="ServerQuery"
                          value={form.virtualserverLogQuery}
                          onChange={updateField}
                        />
                        <CheckboxField
                          disabled={disabled}
                          field="virtualserverLogPermissions"
                          label="Permissions"
                          value={form.virtualserverLogPermissions}
                          onChange={updateField}
                        />
                        <CheckboxField
                          disabled={disabled}
                          field="virtualserverLogFiletransfer"
                          label="File transfer"
                          value={form.virtualserverLogFiletransfer}
                          onChange={updateField}
                        />
                      </div>
                    </SubSection>
                  </CollapsibleSection>
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex-wrap justify-end gap-2 max-sm:[&>*]:w-full">
            <Button disabled={disabled} type="submit">
              OK
            </Button>
            <Button
              disabled={saving}
              type="button"
              variant="outline"
              onClick={() => navigate(-1)}
            >
              Cancel
            </Button>
            <Button
              disabled={disabled || !hasChanges}
              type="button"
              onClick={() => void saveChanges({ leaveAfterSave: false })}
            >
              {saving ? "Saving..." : "Apply"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
