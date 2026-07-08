import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Search,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type ClientDbRow = {
  cldbid: string | number
  clientCreated?: string | number
  clientDescription?: string | null
  clientLastconnected?: string | number
  clientLastip?: string | null
  clientNickname?: string | null
  clientTotalconnections?: string | number
  clientUniqueIdentifier?: string | null
  [key: string]: unknown
}

type PageSize = "25" | "50" | "75" | "all"
type SortDirection = "asc" | "desc"
type SortKey =
  | "nickname"
  | "uid"
  | "created"
  | "last"
  | "total"
  | "lastIp"
  | "description"

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message)
  }
  if (typeof error === "string") return error
  return "TeamSpeak request failed."
}

function isDatabaseEmptyResult(error: unknown) {
  return getErrorMessage(error).toLowerCase().includes("empty result set")
}

function isUsableServerId(value: string | number | undefined | null) {
  return (
    value !== undefined &&
    value !== null &&
    String(value) !== "" &&
    String(value) !== "0"
  )
}

async function fullClientDBList() {
  const clients: ClientDbRow[] = []
  let start = 0
  const duration = 200

  while (true) {
    let nextClients: ClientDbRow[]

    try {
      nextClients = await TeamSpeak.execute<ClientDbRow[]>("clientdblist", {
        duration,
        start,
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

function getNumberValue(value: string | number | undefined) {
  const numericValue = Number(value)

  return Number.isFinite(numericValue) ? numericValue : 0
}

function compareTextValues(firstValue: string, secondValue: string) {
  return firstValue.localeCompare(secondValue, undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

function getClientNickname(client: ClientDbRow) {
  return client.clientNickname || String(client.cldbid)
}

function getClientSearchText(client: ClientDbRow) {
  return [
    client.clientNickname,
    client.clientUniqueIdentifier,
    formatDate(client.clientCreated),
    formatDate(client.clientLastconnected),
    client.clientTotalconnections,
    client.clientLastip,
    client.clientDescription,
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(" ")
    .toLowerCase()
}

export function Clients() {
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const queryUserRef = useRef(queryUser)
  const selectServerFlightRef = useRef<ReturnType<
    typeof TeamSpeak.useServer
  > | null>(null)
  const loadClientsFlightRef = useRef<Promise<void> | null>(null)
  const { dismissToast, showError, showSuccess, toasts } = useToastStack()
  const [clients, setClients] = useState<ClientDbRow[]>([])
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([])
  const [clientsToDelete, setClientsToDelete] = useState<ClientDbRow[]>([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [filter, setFilter] = useState("")
  const [pageSize, setPageSize] = useState<PageSize>("25")
  const [currentPage, setCurrentPage] = useState(1)
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
  const [sortKey, setSortKey] = useState<SortKey | null>(null)

  queryUserRef.current = queryUser

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

  const pageSizeOptions = [
    { label: "25", value: "25" },
    { label: "50", value: "50" },
    { label: "75", value: "75" },
    { label: "All", value: "all" },
  ]

  const selectedClientIdSet = useMemo(
    () => new Set(selectedClientIds),
    [selectedClientIds],
  )

  const selectedRows = useMemo(
    () => clients.filter((client) => selectedClientIdSet.has(String(client.cldbid))),
    [clients, selectedClientIdSet],
  )

  const getSortValue = useCallback((client: ClientDbRow, key: SortKey) => {
    switch (key) {
      case "created":
        return getTimestamp(client.clientCreated)
      case "description":
        return client.clientDescription ?? ""
      case "last":
        return getTimestamp(client.clientLastconnected)
      case "lastIp":
        return client.clientLastip ?? ""
      case "nickname":
        return getClientNickname(client)
      case "total":
        return getNumberValue(client.clientTotalconnections)
      case "uid":
        return client.clientUniqueIdentifier ?? ""
    }
  }, [])

  const filteredClients = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase()

    if (!normalizedFilter) {
      return clients
    }

    return clients.filter((client) =>
      getClientSearchText(client).includes(normalizedFilter),
    )
  }, [clients, filter])

  const sortedClients = useMemo(() => {
    if (!sortKey) {
      return filteredClients
    }

    const directionMultiplier = sortDirection === "asc" ? 1 : -1

    return [...filteredClients].sort((firstClient, secondClient) => {
      const firstValue = getSortValue(firstClient, sortKey)
      const secondValue = getSortValue(secondClient, sortKey)

      if (typeof firstValue === "number" && typeof secondValue === "number") {
        return (firstValue - secondValue) * directionMultiplier
      }

      return (
        compareTextValues(String(firstValue), String(secondValue)) *
        directionMultiplier
      )
    })
  }, [filteredClients, getSortValue, sortDirection, sortKey])

  const totalClients = sortedClients.length
  const numericPageSize =
    pageSize === "all" ? Math.max(totalClients, 1) : Number(pageSize)
  const totalPages =
    pageSize === "all" ? 1 : Math.max(1, Math.ceil(totalClients / numericPageSize))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const pageStartIndex =
    totalClients === 0 ? 0 : (safeCurrentPage - 1) * numericPageSize
  const pageEndIndex =
    pageSize === "all"
      ? totalClients
      : Math.min(totalClients, pageStartIndex + numericPageSize)
  const visibleClients = useMemo(
    () =>
      pageSize === "all"
        ? sortedClients
        : sortedClients.slice(pageStartIndex, pageEndIndex),
    [pageEndIndex, pageSize, pageStartIndex, sortedClients],
  )
  const visibleClientIdSet = useMemo(
    () => new Set(visibleClients.map((client) => String(client.cldbid))),
    [visibleClients],
  )
  const allVisibleSelected =
    visibleClients.length > 0 &&
    visibleClients.every((client) =>
      selectedClientIdSet.has(String(client.cldbid)),
    )

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

  const loadClients = useCallback(
    async (progress: "foreground" | "background" = "foreground") => {
      if (!loadClientsFlightRef.current) {
        loadClientsFlightRef.current = (async () => {
          await ensureSelectedServer()

          try {
            const clientDbList = await fullClientDBList()
            setClients(clientDbList)
          } catch (error) {
            if (isDatabaseEmptyResult(error)) {
              setClients([])
            } else {
              throw error
            }
          }

          setSelectedClientIds([])
          setCurrentPage(1)
        })().finally(() => {
          loadClientsFlightRef.current = null
        })
      }

      if (progress === "foreground") {
        return loadClientsFlightRef.current
      }

      return loadClientsFlightRef.current
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
    loadClients()
      .catch((error: unknown) => {
        if (active) showError(getErrorMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [loadClients, selectedServerId, showError])

  const openDeleteDialog = (rows: ClientDbRow[]) => {
    setClientsToDelete(rows)
    setDeleteDialogOpen(true)
  }

  const closeDeleteDialog = () => {
    if (deleting) {
      return
    }

    setDeleteDialogOpen(false)
    setClientsToDelete([])
  }

  const confirmDeleteClients = async () => {
    if (!clientsToDelete.length) {
      setDeleteDialogOpen(false)
      return
    }

    setDeleting(true)

    try {
      await ensureSelectedServer()

      for (const client of clientsToDelete) {
        await TeamSpeak.execute("clientdbdelete", {
          cldbid: client.cldbid,
        })
      }

      showSuccess(
        clientsToDelete.length === 1 ? "Client deleted" : "Clients deleted",
      )
      setDeleteDialogOpen(false)
      setClientsToDelete([])
      await loadClients("background")
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  const toggleClientSelection = (cldbid: string, selected: boolean) => {
    setSelectedClientIds((currentIds) =>
      selected
        ? [...new Set([...currentIds, cldbid])]
        : currentIds.filter((currentId) => currentId !== cldbid),
    )
  }

  const toggleAllVisibleClients = (selected: boolean) => {
    setSelectedClientIds((currentIds) => {
      if (!selected) {
        return currentIds.filter((id) => !visibleClientIdSet.has(id))
      }

      return [
        ...new Set([
          ...currentIds,
          ...visibleClients.map((client) => String(client.cldbid)),
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
    <div className="mx-auto w-full max-w-none space-y-4">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              disabled={!selectedRows.length || deleting}
              type="button"
              variant="destructive"
              onClick={() => openDeleteDialog(selectedRows)}
            >
              <Trash2 className="size-4" />
              Remove
            </Button>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search"
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value)
                  setCurrentPage(1)
                }}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="space-y-2 px-3 pb-3 md:hidden">
            {loading ? (
              <div className="rounded-md border p-4 text-center text-sm text-muted-foreground">
                ...loading
              </div>
            ) : visibleClients.length ? (
              visibleClients.map((client) => {
                const cldbid = String(client.cldbid)
                const selected = selectedClientIdSet.has(cldbid)
                const nickname = getClientNickname(client)
                const uniqueId = client.clientUniqueIdentifier ?? ""
                const lastIp = client.clientLastip ?? ""

                return (
                  <div
                    className="rounded-md border p-3 text-sm"
                    data-state={selected ? "selected" : undefined}
                    key={cldbid}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(checked) =>
                          toggleClientSelection(cldbid, checked === true)
                        }
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div
                            className="min-w-0 truncate font-medium"
                            title={nickname}
                          >
                            {nickname}
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                              >
                                <MoreVertical className="size-4" />
                                <span className="sr-only">
                                  Open client actions
                                </span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link to={`/client/${client.cldbid}/ban`}>
                                  Ban Client
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => openDeleteDialog([client])}
                              >
                                Delete Client
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <div className="grid gap-2 text-xs">
                          <div className="flex items-start justify-between gap-3">
                            <span className="shrink-0 text-muted-foreground">
                              Unique Identifier
                            </span>
                            <span className="min-w-0 break-all text-right">
                              {uniqueId || "-"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Last IP</span>
                            <span className="min-w-0 truncate text-right">
                              {lastIp || "-"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Created</span>
                            <span className="text-right">
                              {formatDate(client.clientCreated) || "-"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Last</span>
                            <span className="text-right">
                              {formatDate(client.clientLastconnected) || "-"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Total</span>
                            <span className="text-right">
                              {client.clientTotalconnections ?? "-"}
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
                No clients found.
              </div>
            )}
          </div>
          <div className="hidden max-w-full overflow-x-auto px-3 pb-2 sm:px-6 md:block">
            <Table className="w-full min-w-[1180px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allVisibleSelected}
                      disabled={!visibleClients.length}
                      onCheckedChange={(checked) =>
                        toggleAllVisibleClients(checked === true)
                      }
                    />
                  </TableHead>
                  <TableHead className="w-10" />
                  {renderSortableHead(
                    "nickname",
                    "Last Nickname",
                    "min-w-[12rem]",
                  )}
                  {renderSortableHead(
                    "uid",
                    "Unique Identifier",
                    "min-w-[18rem]",
                  )}
                  {renderSortableHead("created", "Created", "w-52")}
                  {renderSortableHead("last", "Last", "w-52")}
                  {renderSortableHead("total", "Total", "min-w-[6rem]")}
                  {renderSortableHead("lastIp", "Last IP", "w-40")}
                  {renderSortableHead(
                    "description",
                    "Description",
                    "min-w-[8rem]",
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      className="h-32 text-center text-muted-foreground"
                      colSpan={9}
                    >
                      ...loading
                    </TableCell>
                  </TableRow>
                ) : clients.length ? (
                  visibleClients.map((client) => {
                    const cldbid = String(client.cldbid)
                    const selected = selectedClientIdSet.has(cldbid)
                    const nickname = getClientNickname(client)
                    const uniqueId = client.clientUniqueIdentifier ?? ""
                    const lastIp = client.clientLastip ?? ""
                    const description = client.clientDescription ?? ""

                    return (
                      <TableRow
                        data-state={selected ? "selected" : undefined}
                        key={cldbid}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(checked) =>
                              toggleClientSelection(cldbid, checked === true)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                              >
                                <MoreVertical className="size-4" />
                                <span className="sr-only">
                                  Open client actions
                                </span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem asChild>
                                <Link to={`/client/${client.cldbid}/ban`}>
                                  Ban Client
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => openDeleteDialog([client])}
                              >
                                Delete Client
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        <TableCell
                          className="max-w-[14rem] truncate"
                          title={nickname}
                        >
                          {nickname}
                        </TableCell>
                        <TableCell
                          className="max-w-[20rem] truncate"
                          title={uniqueId}
                        >
                          {uniqueId || "-"}
                        </TableCell>
                        <TableCell>{formatDate(client.clientCreated) || "-"}</TableCell>
                        <TableCell>
                          {formatDate(client.clientLastconnected) || "-"}
                        </TableCell>
                        <TableCell>
                          {client.clientTotalconnections ?? "-"}
                        </TableCell>
                        <TableCell
                          className="max-w-[10rem] truncate"
                          title={lastIp}
                        >
                          {lastIp || "-"}
                        </TableCell>
                        <TableCell
                          className="max-w-[18rem] truncate"
                          title={description}
                        >
                          {description || "-"}
                        </TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      className="h-32 text-center text-muted-foreground"
                      colSpan={9}
                    >
                      No clients found.
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
                      value === "25" ||
                      value === "50" ||
                      value === "75" ||
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
              {totalClients === 0
                ? "0-0 of 0"
                : `${pageStartIndex + 1}-${pageEndIndex} of ${totalClients}`}
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
        open={deleteDialogOpen}
        preventClose={deleting}
        title={clientsToDelete.length === 1 ? "Delete Client" : "Delete Clients"}
        footer={
          <>
            <Button
              disabled={deleting}
              type="button"
              variant="destructive"
              onClick={confirmDeleteClients}
            >
              {deleting ? "Deleting..." : "Yes"}
            </Button>
            <Button
              disabled={deleting}
              type="button"
              variant="outline"
              onClick={closeDeleteDialog}
            >
              No
            </Button>
          </>
        }
        onClose={closeDeleteDialog}
      >
        <p className="text-sm text-muted-foreground">
          Do you really want to delete{" "}
          <span className="font-semibold text-foreground">
            {clientsToDelete.length === 1
              ? getClientNickname(clientsToDelete[0])
              : "all selected clients"}
          </span>{" "}
          from the list?
        </p>
      </AppModal>
    </div>
  )
}
