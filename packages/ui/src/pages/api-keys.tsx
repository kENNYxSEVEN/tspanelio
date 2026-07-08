import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
  Trash2,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth } from "@/auth/auth-context"
import { AppModal } from "@/components/app-modal"
import { AppSelect } from "@/components/app-select"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { copyTextToClipboard } from "@/lib/clipboard"

type ApiKeyRow = {
  apikey?: string
  cldbid?: string | number
  createdAt?: string | number
  expiresAt?: string | number
  id: string | number
  scope?: string
  [key: string]: unknown
}

type ClientDbRow = {
  cldbid: string | number
  clientNickname: string
  [key: string]: unknown
}

type CreateApiKeyForm = {
  lifetime: string
  scope: string
  selectedClient: string
}

type PageSize = "5" | "10" | "15" | "all"
type SortDirection = "asc" | "desc"
type SortKey = "client" | "scope" | "created" | "expires"

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message)
  }
  if (typeof error === "string") return error
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

function isDatabaseEmptyResult(error: unknown) {
  return getErrorMessage(error).toLowerCase().includes("empty result set")
}

async function fullClientDBList() {
  const clients: ClientDbRow[] = []
  let start = 0
  const duration = 200

  while (true) {
    let nextClients: ClientDbRow[]

    try {
      nextClients = await TeamSpeak.execute<ClientDbRow[]>("clientdblist", {
        start,
        duration,
      })
    } catch (error) {
      if (isDatabaseEmptyResult(error)) {
        break
      }

      throw error
    }

    if (!Array.isArray(nextClients) || !nextClients.length) break

    clients.push(...nextClients)

    if (nextClients.length < duration) break

    start += duration
  }

  return clients
}

function formatDate(value: string | number | undefined) {
  if (value === undefined || value === "") {
    return ""
  }

  const timestamp = Number(value)

  if (!Number.isFinite(timestamp)) {
    return String(value)
  }

  return new Date(timestamp * 1000).toLocaleString()
}

function getTimestamp(value: string | number | undefined) {
  const timestamp = Number(value)

  return Number.isFinite(timestamp) ? timestamp : 0
}

function compareTextValues(firstValue: string, secondValue: string) {
  return firstValue.localeCompare(secondValue, undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

function getClientOptionLabel(client: ClientDbRow) {
  return `${client.clientNickname} (${String(client.cldbid)})`
}

type ClientSearchSelectProps = {
  clients: ClientDbRow[]
  disabled?: boolean
  onChange: (value: string) => void
  placeholder?: string
  value: string
}

function ClientSearchSelect({
  clients,
  disabled,
  onChange,
  placeholder = "Select client",
  value,
}: ClientSearchSelectProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const selectedClient = useMemo(
    () => clients.find((client) => String(client.cldbid) === value),
    [clients, value],
  )
  const selectedLabel = selectedClient
    ? getClientOptionLabel(selectedClient)
    : ""

  const filteredClients = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    if (!normalizedSearch) {
      return clients
    }

    return clients.filter((client) => {
      const clientId = String(client.cldbid).toLowerCase()
      const nickname = client.clientNickname.toLowerCase()
      const combinedLabel = getClientOptionLabel(client).toLowerCase()

      return (
        nickname.includes(normalizedSearch) ||
        clientId.includes(normalizedSearch) ||
        combinedLabel.includes(normalizedSearch)
      )
    })
  }, [clients, search])

  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setSearch("")
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
    }
  }, [open])

  const openDropdown = () => {
    if (disabled) {
      return
    }

    setOpen(true)
    setSearch(selectedLabel)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }

  const selectClient = (client: ClientDbRow) => {
    onChange(String(client.cldbid))
    setOpen(false)
    setSearch("")
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={open ? search : selectedLabel}
          onChange={(event) => {
            setSearch(event.target.value)
            setOpen(true)
          }}
          onFocus={openDropdown}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false)
              setSearch("")
            }
          }}
        />
        <button
          aria-label={open ? "Close client dropdown" : "Open client dropdown"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled}
          type="button"
          onClick={() => {
            if (open) {
              setOpen(false)
              setSearch("")
              return
            }

            openDropdown()
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <ChevronDown
            className={
              "size-4 transition-transform " + (open ? "rotate-180" : "")
            }
          />
        </button>
      </div>

      {open ? (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {clients.length ? (
            filteredClients.length ? (
              filteredClients.map((client) => {
                const clientId = String(client.cldbid)
                const selected = value === clientId

                return (
                  <button
                    key={clientId}
                    className={
                      "flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm outline-none transition-colors " +
                      (selected ? "bg-muted text-foreground" : "hover:bg-muted")
                    }
                    disabled={disabled}
                    type="button"
                    onClick={() => selectClient(client)}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">
                        {client.clientNickname}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {clientId}
                      </span>
                    </span>
                    {selected ? (
                      <span className="shrink-0 text-sm">✓</span>
                    ) : null}
                  </button>
                )
              })
            ) : (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No clients found.
              </div>
            )
          ) : (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No clients loaded.
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

export function ApiKeys() {
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const queryUserRef = useRef(queryUser)
  const selectServerFlightRef = useRef<ReturnType<
    typeof TeamSpeak.useServer
  > | null>(null)
  const clientsRef = useRef<ClientDbRow[]>([])
  const loadApiKeysFlightRef = useRef<Promise<void> | null>(null)
  const { dismissToast, showError, showInfo, showSuccess, toasts } =
    useToastStack()
  const showErrorRef = useRef(showError)
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([])
  const [clients, setClients] = useState<ClientDbRow[]>([])
  const [selectedApiKeyIds, setSelectedApiKeyIds] = useState<string[]>([])
  const [form, setForm] = useState<CreateApiKeyForm>({
    lifetime: "",
    scope: "",
    selectedClient: "",
  })
  const [generatedApiKey, setGeneratedApiKey] = useState("")
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [apiKeysToDelete, setApiKeysToDelete] = useState<ApiKeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pageSize, setPageSize] = useState<PageSize>("10")
  const [currentPage, setCurrentPage] = useState(1)
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
  const [sortKey, setSortKey] = useState<SortKey | null>(null)

  queryUserRef.current = queryUser
  showErrorRef.current = showError

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

  const scopeOptions = [
    { label: "Manage", value: "manage" },
    { label: "Write", value: "write" },
    { label: "Read", value: "read" },
  ]

  const pageSizeOptions = [
    { label: "5", value: "5" },
    { label: "10", value: "10" },
    { label: "15", value: "15" },
    { label: "All", value: "all" },
  ]

  const clientNameById = useMemo(
    () =>
      new Map(
        clients.map((client) => [
          String(client.cldbid),
          `${client.clientNickname} (${String(client.cldbid)})`,
        ]),
      ),
    [clients],
  )

  const selectedApiKeyIdSet = useMemo(
    () => new Set(selectedApiKeyIds),
    [selectedApiKeyIds],
  )

  const selectedRows = useMemo(
    () =>
      apiKeys.filter((apiKey) => selectedApiKeyIdSet.has(String(apiKey.id))),
    [apiKeys, selectedApiKeyIdSet],
  )

  const getClientDisplay = useCallback(
    (apiKey: ApiKeyRow) => {
      const cldbid = String(apiKey.cldbid ?? "")

      if (!cldbid) {
        return "—"
      }

      return clientNameById.get(cldbid) ?? cldbid
    },
    [clientNameById],
  )

  const getSortValue = useCallback(
    (apiKey: ApiKeyRow, key: SortKey) => {
      switch (key) {
        case "client":
          return getClientDisplay(apiKey)
        case "created":
          return getTimestamp(apiKey.createdAt)
        case "expires":
          return getTimestamp(apiKey.expiresAt)
        case "scope":
          return apiKey.scope ?? ""
      }
    },
    [getClientDisplay],
  )

  const sortedApiKeys = useMemo(() => {
    if (!sortKey) {
      return apiKeys
    }

    const directionMultiplier = sortDirection === "asc" ? 1 : -1

    return [...apiKeys].sort((firstApiKey, secondApiKey) => {
      const firstValue = getSortValue(firstApiKey, sortKey)
      const secondValue = getSortValue(secondApiKey, sortKey)

      if (typeof firstValue === "number" && typeof secondValue === "number") {
        return (firstValue - secondValue) * directionMultiplier
      }

      return (
        compareTextValues(String(firstValue), String(secondValue)) *
        directionMultiplier
      )
    })
  }, [apiKeys, getSortValue, sortDirection, sortKey])

  const totalApiKeys = sortedApiKeys.length
  const numericPageSize =
    pageSize === "all" ? Math.max(totalApiKeys, 1) : Number(pageSize)
  const totalPages =
    pageSize === "all"
      ? 1
      : Math.max(1, Math.ceil(totalApiKeys / numericPageSize))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const pageStartIndex =
    totalApiKeys === 0 ? 0 : (safeCurrentPage - 1) * numericPageSize
  const pageEndIndex =
    pageSize === "all"
      ? totalApiKeys
      : Math.min(totalApiKeys, pageStartIndex + numericPageSize)
  const visibleApiKeys = useMemo(
    () =>
      pageSize === "all"
        ? sortedApiKeys
        : sortedApiKeys.slice(pageStartIndex, pageEndIndex),
    [pageEndIndex, pageSize, pageStartIndex, sortedApiKeys],
  )
  const visibleApiKeyIdSet = useMemo(
    () => new Set(visibleApiKeys.map((apiKey) => String(apiKey.id))),
    [visibleApiKeys],
  )
  const allVisibleSelected =
    visibleApiKeys.length > 0 &&
    visibleApiKeys.every((apiKey) => selectedApiKeyIdSet.has(String(apiKey.id)))

  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(page, 1), totalPages))
  }, [totalPages])

  const handleSort = (key: SortKey) => {
    setCurrentPage(1)

    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"))
      return
    }

    setSortKey(key)
    setSortDirection("asc")
  }

  const renderSortableHead = (
    key: SortKey,
    label: string,
    className?: string,
  ) => {
    const active = sortKey === key
    const Icon = active
      ? sortDirection === "asc"
        ? ArrowUp
        : ArrowDown
      : ArrowUpDown

    return (
      <TableHead className={className}>
        <button
          aria-label={
            "Sort by " +
            label +
            (active
              ? sortDirection === "asc"
                ? ", ascending"
                : ", descending"
              : "")
          }
          className="flex w-full items-center gap-1 text-left font-medium transition-colors hover:text-foreground"
          type="button"
          onClick={() => handleSort(key)}
        >
          <span>{label}</span>
          <Icon
            className={
              active
                ? "size-3.5 text-foreground"
                : "size-3.5 text-muted-foreground"
            }
          />
        </button>
      </TableHead>
    )
  }

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

    if (!selectServerFlightRef.current) {
      selectServerFlightRef.current = TeamSpeak.useServer(
        validSelectedServerId,
        { progress: "background" },
      ).finally(() => {
        selectServerFlightRef.current = null
      })
    }

    await selectServerFlightRef.current
    saveServerId(validSelectedServerId)

    const nextQueryUser = await TeamSpeak.ensureQueryIdentity({
      progress: "background",
    })

    if (nextQueryUser) {
      queryUserRef.current = nextQueryUser
      saveQueryUser(nextQueryUser)
    }

    return queryUserRef.current
  }, [saveQueryUser, saveServerId, selectedServerId])

  const loadApiKeys = useCallback(
    async (progress: "foreground" | "background" = "foreground") => {
      if (loadApiKeysFlightRef.current) {
        await loadApiKeysFlightRef.current
        return
      }

      const flight = (async () => {
        await ensureSelectedServer()

        const cachedClients = clientsRef.current
        const [nextApiKeys, nextClients] = await Promise.all([
          TeamSpeak.execute<ApiKeyRow[]>("apikeylist", { cldbid: "*" }, [], {
            progress,
          }),
          cachedClients.length
            ? Promise.resolve(cachedClients)
            : fullClientDBList(),
        ])

        const safeClients = Array.isArray(nextClients) ? nextClients : []

        clientsRef.current = safeClients
        setApiKeys(Array.isArray(nextApiKeys) ? nextApiKeys : [])
        setClients(safeClients)
        setSelectedApiKeyIds([])
        setCurrentPage(1)
      })()

      loadApiKeysFlightRef.current = flight

      try {
        await flight
      } finally {
        if (loadApiKeysFlightRef.current === flight) {
          loadApiKeysFlightRef.current = null
        }
      }
    },
    [ensureSelectedServer],
  )

  useEffect(() => {
    let active = true

    if (!isUsableServerId(selectedServerId)) {
      setLoading(false)
      return () => {
        active = false
      }
    }

    setLoading(true)
    loadApiKeys()
      .catch((error: unknown) => {
        if (active) showErrorRef.current(getErrorMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [loadApiKeys, selectedServerId])

  const resetCreateForm = () => {
    setForm({
      lifetime: "",
      scope: "",
      selectedClient: "",
    })
    setGeneratedApiKey("")
  }

  const openAddDialog = () => {
    resetCreateForm()
    setAddDialogOpen(true)
  }

  const closeAddDialog = () => {
    if (creating) {
      return
    }

    setAddDialogOpen(false)
    resetCreateForm()
  }

  const copyApiKey = async (apiKey: string) => {
    try {
      await copyTextToClipboard(apiKey)
      showInfo("API Key Copied To Clipboard")
    } catch (error) {
      showError(getErrorMessage(error))
    }
  }

  const openDeleteDialog = (rows: ApiKeyRow[]) => {
    setApiKeysToDelete(rows)
    setDeleteDialogOpen(true)
  }

  const confirmDeleteApiKeys = async () => {
    if (!apiKeysToDelete.length) {
      setDeleteDialogOpen(false)
      return
    }

    setDeleting(true)

    try {
      await ensureSelectedServer()

      for (const apiKey of apiKeysToDelete) {
        await TeamSpeak.execute("apikeydel", { id: apiKey.id })
      }

      showSuccess(
        apiKeysToDelete.length === 1 ? "API key deleted" : "API keys deleted",
      )
      setDeleteDialogOpen(false)
      setApiKeysToDelete([])
      await loadApiKeys("background")
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  const createApiKey = async () => {
    if (!form.scope) {
      showError("Select a scope first.")
      return
    }

    if (!form.selectedClient) {
      showError("Select a client first.")
      return
    }

    setCreating(true)

    try {
      await ensureSelectedServer()

      const params: Record<string, string> = {
        scope: form.scope,
      }

      params.cldbid = form.selectedClient

      if (form.lifetime) {
        params.lifetime = form.lifetime
      }

      const response = await TeamSpeak.execute<Array<{ apikey?: string }>>(
        "apikeyadd",
        params,
      )
      const nextApiKey = response[0]?.apikey ?? ""

      setGeneratedApiKey(nextApiKey)
      showSuccess("API key successfully created")
      await loadApiKeys("background")
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setCreating(false)
    }
  }

  const toggleApiKeySelection = (id: string, selected: boolean) => {
    setSelectedApiKeyIds((currentIds) =>
      selected
        ? [...new Set([...currentIds, id])]
        : currentIds.filter((currentId) => currentId !== id),
    )
  }

  const toggleAllVisibleApiKeys = (selected: boolean) => {
    setSelectedApiKeyIds((currentIds) => {
      if (!selected) {
        return currentIds.filter((id) => !visibleApiKeyIdSet.has(id))
      }

      return [
        ...new Set([
          ...currentIds,
          ...visibleApiKeys.map((apiKey) => String(apiKey.id)),
        ]),
      ]
    })
  }

  if (!isUsableServerId(selectedServerId)) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <Card>
          <CardHeader>
            <CardTitle>No server selected</CardTitle>
            <CardDescription>
              Select an online virtual server from Server List first.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild>
              <Link to="/servers">Go to Server List</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={openAddDialog}>
              <Plus className="size-4" />
              Add API Key
            </Button>
            <Button
              disabled={!selectedRows.length || deleting}
              type="button"
              variant="destructive"
              onClick={() => openDeleteDialog(selectedRows)}
            >
              <Trash2 className="size-4" />
              Remove
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="space-y-2 px-3 pb-3 md:hidden">
            {loading ? (
              <div className="rounded-md border p-4 text-center text-sm text-muted-foreground">
                ...loading
              </div>
            ) : visibleApiKeys.length ? (
              visibleApiKeys.map((apiKey) => {
                const id = String(apiKey.id)
                const selected = selectedApiKeyIdSet.has(id)
                const clientDisplay = getClientDisplay(apiKey)

                return (
                  <div
                    className="rounded-md border p-3 text-sm"
                    data-state={selected ? "selected" : undefined}
                    key={id}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(checked) =>
                          toggleApiKeySelection(id, checked === true)
                        }
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div
                          className="truncate font-medium"
                          title={clientDisplay}
                        >
                          {clientDisplay}
                        </div>
                        <div className="grid gap-2 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Scope</span>
                            <span className="min-w-0 truncate text-right">
                              {apiKey.scope ?? ""}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">
                              Created At
                            </span>
                            <span className="text-right">
                              {formatDate(apiKey.createdAt)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">
                              Expires At
                            </span>
                            <span className="text-right">
                              {formatDate(apiKey.expiresAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="rounded-md border p-4 text-center text-sm text-muted-foreground">
                No API keys found.
              </div>
            )}
          </div>
          <div className="hidden max-w-full overflow-x-auto px-3 pb-2 sm:px-6 md:block">
            <Table className="w-full min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={allVisibleSelected}
                      disabled={!visibleApiKeys.length}
                      onCheckedChange={(checked) =>
                        toggleAllVisibleApiKeys(checked === true)
                      }
                    />
                  </TableHead>
                  {renderSortableHead("client", "Client", "min-w-[16rem]")}
                  {renderSortableHead("scope", "Scope", "w-32")}
                  {renderSortableHead("created", "Created At", "w-48")}
                  {renderSortableHead("expires", "Expires At", "w-48")}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      className="h-32 text-center text-muted-foreground"
                      colSpan={5}
                    >
                      ...loading
                    </TableCell>
                  </TableRow>
                ) : apiKeys.length ? (
                  visibleApiKeys.map((apiKey) => {
                    const id = String(apiKey.id)
                    const selected = selectedApiKeyIdSet.has(id)
                    const clientDisplay = getClientDisplay(apiKey)

                    return (
                      <TableRow
                        key={id}
                        data-state={selected ? "selected" : undefined}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(checked) =>
                              toggleApiKeySelection(id, checked === true)
                            }
                          />
                        </TableCell>
                        <TableCell
                          className="max-w-[16rem] truncate"
                          title={clientDisplay}
                        >
                          <span className="inline-flex max-w-full items-center truncate rounded-full bg-muted px-3 py-1 text-sm">
                            {clientDisplay}
                          </span>
                        </TableCell>
                        <TableCell>{apiKey.scope ?? ""}</TableCell>
                        <TableCell>{formatDate(apiKey.createdAt)}</TableCell>
                        <TableCell>{formatDate(apiKey.expiresAt)}</TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      className="h-32 text-center text-muted-foreground"
                      colSpan={5}
                    >
                      No API keys found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-3 text-sm text-muted-foreground sm:justify-end sm:gap-5 sm:px-6">
            <div className="flex items-center gap-2">
              <span>Rows per page:</span>
              <div className="w-24">
                <AppSelect
                  options={pageSizeOptions}
                  value={pageSize}
                  onChange={(value) => {
                    if (
                      value === "5" ||
                      value === "10" ||
                      value === "15" ||
                      value === "all"
                    ) {
                      setPageSize(value)
                      setCurrentPage(1)
                    }
                  }}
                />
              </div>
            </div>
            <div className="min-w-[6.5rem] text-right text-foreground">
              {totalApiKeys === 0
                ? "0-0 of 0"
                : `${pageStartIndex + 1}-${pageEndIndex} of ${totalApiKeys}`}
            </div>
            <div className="flex items-center gap-1">
              <Button
                disabled={safeCurrentPage <= 1 || pageSize === "all"}
                size="icon"
                type="button"
                variant="ghost"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                <ChevronLeft className="size-4" />
                <span className="sr-only">Previous page</span>
              </Button>
              <Button
                disabled={safeCurrentPage >= totalPages || pageSize === "all"}
                size="icon"
                type="button"
                variant="ghost"
                onClick={() =>
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
                }
              >
                <ChevronRight className="size-4" />
                <span className="sr-only">Next page</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AppModal
        open={addDialogOpen}
        preventClose={creating}
        title="Add API Key"
        footer={
          <>
            <Button
              disabled={creating || !form.scope || !form.selectedClient}
              type="button"
              onClick={createApiKey}
            >
              {creating ? "Creating..." : "Create"}
            </Button>
            <Button
              disabled={creating}
              type="button"
              variant="outline"
              onClick={closeAddDialog}
            >
              Close
            </Button>
          </>
        }
        onClose={closeAddDialog}
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Scope</Label>
            <AppSelect
              disabled={creating}
              options={scopeOptions}
              placeholder="Select scope"
              value={form.scope}
              onChange={(value) =>
                setForm((currentForm) => ({ ...currentForm, scope: value }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="api-key-lifetime">Lifetime</Label>
            <div className="flex items-center gap-2">
              <Input
                id="api-key-lifetime"
                min={1}
                placeholder="14"
                type="number"
                value={form.lifetime}
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    lifetime: event.target.value,
                  }))
                }
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Client</Label>
            <ClientSearchSelect
              clients={clients}
              disabled={creating}
              placeholder="Select client"
              value={form.selectedClient}
              onChange={(value) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  selectedClient: value,
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label>Generated API Key</Label>
            <div className="flex min-w-0 gap-2">
              <code className="flex min-h-10 min-w-0 flex-1 select-all items-center truncate rounded-lg border bg-muted px-3 font-mono text-xs">
                {generatedApiKey}
              </code>
              <Button
                disabled={!generatedApiKey}
                size="icon"
                type="button"
                variant="outline"
                onClick={() => void copyApiKey(generatedApiKey)}
              >
                <Copy className="size-4" />
                <span className="sr-only">Copy generated API key</span>
              </Button>
            </div>
          </div>
        </div>
      </AppModal>

      <AppModal
        open={deleteDialogOpen}
        preventClose={deleting}
        title={
          apiKeysToDelete.length > 1 ? "Delete API Keys" : "Delete API Key"
        }
        footer={
          <>
            <Button
              disabled={deleting}
              type="button"
              variant="destructive"
              onClick={confirmDeleteApiKeys}
            >
              {deleting ? "Deleting..." : "Yes"}
            </Button>
            <Button
              disabled={deleting}
              type="button"
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              No
            </Button>
          </>
        }
        onClose={() => setDeleteDialogOpen(false)}
      >
        <p className="text-sm text-muted-foreground">
          {apiKeysToDelete.length > 1
            ? `Do you really want to delete the selected ${apiKeysToDelete.length} API keys?`
            : "Do you really want to delete this API key?"}
        </p>
      </AppModal>
    </div>
  )
}
