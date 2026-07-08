import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Plus,
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
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

type BanRow = {
  banid: string | number
  created?: string | number
  duration?: string | number
  ip?: string | null
  name?: string | null
  reason?: string | null
  uid?: string | null
  [key: string]: unknown
}

type CreateBanForm = {
  ip: string
  name: string
  reason: string
  time: string
  uid: string
  unit: string
}

type PageSize = "25" | "50" | "75" | "all"
type SortDirection = "asc" | "desc"
type SortKey = "target" | "reason" | "expires"

const defaultCreateBanForm: CreateBanForm = {
  ip: "",
  name: "",
  reason: "",
  time: "1",
  uid: "",
  unit: "86400",
}

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

function compareTextValues(firstValue: string, secondValue: string) {
  return firstValue.localeCompare(secondValue, undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

function getNumberValue(value: string | number | undefined) {
  const numericValue = Number(value)

  return Number.isFinite(numericValue) ? numericValue : 0
}

function getBanTargetText(ban: BanRow) {
  const parts = [
    ban.ip ? `ip = ${ban.ip}` : "",
    ban.name ? `name = ${ban.name}` : "",
    ban.uid ? `uid = ${ban.uid}` : "",
  ].filter(Boolean)

  return parts.join(", ")
}

function getBanSearchText(ban: BanRow) {
  return [
    ban.banid,
    ban.ip,
    ban.name,
    ban.uid,
    ban.reason,
    getBanExpiryDisplay(ban),
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(" ")
    .toLowerCase()
}

function getBanExpiryDisplay(ban: BanRow) {
  const duration = getNumberValue(ban.duration)

  if (duration === 0) {
    return "infinite"
  }

  const created = getNumberValue(ban.created)

  if (!created) {
    return ""
  }

  return new Date(created * 1000 + duration * 1000).toLocaleString()
}

function getBanExpiryTimestamp(ban: BanRow) {
  const duration = getNumberValue(ban.duration)

  if (duration === 0) {
    return Number.POSITIVE_INFINITY
  }

  return getNumberValue(ban.created) + duration
}

function getBanTime(form: CreateBanForm) {
  const unit = Number(form.unit)

  if (unit === 0) {
    return 0
  }

  return Number(form.time || 0) * unit
}

function getOptimalTimeUnit(seconds: number) {
  if (!seconds) return "0"
  if (Number.isInteger(seconds / 86400)) return "86400"
  if (Number.isInteger(seconds / 3600)) return "3600"
  if (Number.isInteger(seconds / 60)) return "60"
  return "1"
}

function createFormFromBan(ban: BanRow): CreateBanForm {
  const duration = getNumberValue(ban.duration)
  const unit = getOptimalTimeUnit(duration)
  const time = unit === "0" ? "0" : String(duration / Number(unit))

  return {
    ip: ban.ip ?? "",
    name: ban.name ?? "",
    reason: ban.reason ?? "",
    time,
    uid: ban.uid ?? "",
    unit,
  }
}

export function Bans() {
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const queryUserRef = useRef(queryUser)
  const selectServerFlightRef = useRef<ReturnType<
    typeof TeamSpeak.useServer
  > | null>(null)
  const { dismissToast, showError, showSuccess, toasts } = useToastStack()
  const [bans, setBans] = useState<BanRow[]>([])
  const [selectedBanIds, setSelectedBanIds] = useState<string[]>([])
  const [bansToDelete, setBansToDelete] = useState<BanRow[]>([])
  const [banToEdit, setBanToEdit] = useState<BanRow | null>(null)
  const [form, setForm] = useState<CreateBanForm>(defaultCreateBanForm)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
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

  const timeUnitOptions = [
    { label: "seconds", value: "1" },
    { label: "minutes", value: "60" },
    { label: "hours", value: "3600" },
    { label: "days", value: "86400" },
    { label: "permanent", value: "0" },
  ]

  const selectedBanIdSet = useMemo(
    () => new Set(selectedBanIds),
    [selectedBanIds],
  )

  const selectedRows = useMemo(
    () => bans.filter((ban) => selectedBanIdSet.has(String(ban.banid))),
    [bans, selectedBanIdSet],
  )

  const getSortValue = useCallback((ban: BanRow, key: SortKey) => {
    switch (key) {
      case "expires":
        return getBanExpiryTimestamp(ban)
      case "reason":
        return ban.reason ?? ""
      case "target":
        return getBanTargetText(ban)
    }
  }, [])

  const filteredBans = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase()

    if (!normalizedFilter) {
      return bans
    }

    return bans.filter((ban) => getBanSearchText(ban).includes(normalizedFilter))
  }, [bans, filter])

  const sortedBans = useMemo(() => {
    if (!sortKey) {
      return filteredBans
    }

    const directionMultiplier = sortDirection === "asc" ? 1 : -1

    return [...filteredBans].sort((firstBan, secondBan) => {
      const firstValue = getSortValue(firstBan, sortKey)
      const secondValue = getSortValue(secondBan, sortKey)

      if (typeof firstValue === "number" && typeof secondValue === "number") {
        return (firstValue - secondValue) * directionMultiplier
      }

      return (
        compareTextValues(String(firstValue), String(secondValue)) *
        directionMultiplier
      )
    })
  }, [filteredBans, getSortValue, sortDirection, sortKey])

  const totalBans = sortedBans.length
  const numericPageSize =
    pageSize === "all" ? Math.max(totalBans, 1) : Number(pageSize)
  const totalPages =
    pageSize === "all"
      ? 1
      : Math.max(1, Math.ceil(totalBans / numericPageSize))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const pageStartIndex =
    totalBans === 0 ? 0 : (safeCurrentPage - 1) * numericPageSize
  const pageEndIndex =
    pageSize === "all"
      ? totalBans
      : Math.min(totalBans, pageStartIndex + numericPageSize)
  const visibleBans = useMemo(
    () =>
      pageSize === "all"
        ? sortedBans
        : sortedBans.slice(pageStartIndex, pageEndIndex),
    [pageEndIndex, pageSize, pageStartIndex, sortedBans],
  )
  const visibleBanIdSet = useMemo(
    () => new Set(visibleBans.map((ban) => String(ban.banid))),
    [visibleBans],
  )
  const allVisibleSelected =
    visibleBans.length > 0 &&
    visibleBans.every((ban) => selectedBanIdSet.has(String(ban.banid)))

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

  const loadBans = useCallback(
    async (progress: "foreground" | "background" = "foreground") => {
      await ensureSelectedServer()

      try {
        const banList = await TeamSpeak.execute<BanRow[]>(
          "banlist",
          {},
          [],
          { progress },
        )

        setBans(Array.isArray(banList) ? banList : [])
      } catch (error) {
        if (isDatabaseEmptyResult(error)) {
          setBans([])
        } else {
          throw error
        }
      }

      setSelectedBanIds([])
      setCurrentPage(1)
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
    loadBans()
      .catch((error: unknown) => {
        if (active) showError(getErrorMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [loadBans, selectedServerId, showError])

  const resetForm = () => {
    setForm({ ...defaultCreateBanForm })
  }

  const openAddDialog = () => {
    resetForm()
    setAddDialogOpen(true)
  }

  const closeAddDialog = () => {
    if (creating) {
      return
    }

    setAddDialogOpen(false)
    resetForm()
  }

  const openDeleteDialog = (rows: BanRow[]) => {
    setBansToDelete(rows)
    setDeleteDialogOpen(true)
  }

  const openEditDialog = (ban: BanRow) => {
    setBanToEdit(ban)
    setForm(createFormFromBan(ban))
    setEditDialogOpen(true)
  }

  const closeEditDialog = () => {
    if (creating) {
      return
    }

    setEditDialogOpen(false)
    setBanToEdit(null)
    resetForm()
  }

  const createBan = async () => {
    if (!form.ip && !form.name && !form.uid) {
      showError("Enter IP, Name, or Unique ID first.")
      return
    }

    setCreating(true)

    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("banadd", {
        banreason: form.reason,
        ip: form.ip || null,
        name: form.name || null,
        time: getBanTime(form),
        uid: form.uid || null,
      })

      showSuccess("Ban created")
      setAddDialogOpen(false)
      resetForm()
      await loadBans("background")
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setCreating(false)
    }
  }

  const editBan = async () => {
    if (!banToEdit) {
      setEditDialogOpen(false)
      return
    }

    if (!form.ip && !form.name && !form.uid) {
      showError("Enter IP, Name, or Unique ID first.")
      return
    }

    setCreating(true)

    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("banadd", {
        banreason: form.reason,
        ip: form.ip || null,
        name: form.name || null,
        time: getBanTime(form),
        uid: form.uid || null,
      })
      await TeamSpeak.execute("bandel", { banid: banToEdit.banid })

      showSuccess("Ban updated")
      setEditDialogOpen(false)
      setBanToEdit(null)
      resetForm()
      await loadBans("background")
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setCreating(false)
    }
  }

  const confirmDeleteBans = async () => {
    if (!bansToDelete.length) {
      setDeleteDialogOpen(false)
      return
    }

    setDeleting(true)

    try {
      await ensureSelectedServer()

      for (const ban of bansToDelete) {
        await TeamSpeak.execute("bandel", { banid: ban.banid })
      }

      showSuccess(bansToDelete.length === 1 ? "Ban deleted" : "Bans deleted")
      setDeleteDialogOpen(false)
      setBansToDelete([])
      await loadBans("background")
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  const toggleBanSelection = (banid: string, selected: boolean) => {
    setSelectedBanIds((currentIds) =>
      selected
        ? [...new Set([...currentIds, banid])]
        : currentIds.filter((currentId) => currentId !== banid),
    )
  }

  const toggleAllVisibleBans = (selected: boolean) => {
    setSelectedBanIds((currentIds) => {
      if (!selected) {
        return currentIds.filter((id) => !visibleBanIdSet.has(id))
      }

      return [
        ...new Set([
          ...currentIds,
          ...visibleBans.map((ban) => String(ban.banid)),
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={openAddDialog}>
                <Plus className="size-4" />
                Add Ban
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
            ) : visibleBans.length ? (
              visibleBans.map((ban) => {
                const banid = String(ban.banid)
                const selected = selectedBanIdSet.has(banid)
                const targetText = getBanTargetText(ban)

                return (
                  <div
                    className="rounded-md border p-3 text-sm"
                    data-state={selected ? "selected" : undefined}
                    key={banid}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(checked) =>
                          toggleBanSelection(banid, checked === true)
                        }
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div
                            className="min-w-0 break-words font-medium"
                            title={targetText}
                          >
                            {targetText || "-"}
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                              >
                                <MoreVertical className="size-4" />
                                <span className="sr-only">Open ban actions</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => openEditDialog(ban)}>
                                Edit Ban
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => openDeleteDialog([ban])}
                              >
                                Remove Ban
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <div className="grid gap-2 text-xs">
                          <div className="flex items-start justify-between gap-3">
                            <span className="shrink-0 text-muted-foreground">
                              Reason
                            </span>
                            <span className="min-w-0 break-words text-right">
                              {ban.reason || "-"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Expires</span>
                            <span className="text-right">
                              {getBanExpiryDisplay(ban) || "-"}
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
                No bans found.
              </div>
            )}
          </div>
          <div className="hidden max-w-full overflow-x-auto px-3 pb-2 sm:px-6 md:block">
            <Table className="w-full min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allVisibleSelected}
                      disabled={!visibleBans.length}
                      onCheckedChange={(checked) =>
                        toggleAllVisibleBans(checked === true)
                      }
                    />
                  </TableHead>
                  <TableHead className="w-10" />
                  {renderSortableHead("target", "Name/IP/UID", "min-w-[22rem]")}
                  {renderSortableHead("reason", "Reason", "min-w-[14rem]")}
                  {renderSortableHead("expires", "Expires", "w-52")}
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
                ) : bans.length ? (
                  visibleBans.map((ban) => {
                    const banid = String(ban.banid)
                    const selected = selectedBanIdSet.has(banid)
                    const targetText = getBanTargetText(ban)

                    return (
                      <TableRow
                        data-state={selected ? "selected" : undefined}
                        key={banid}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(checked) =>
                              toggleBanSelection(banid, checked === true)
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
                                <span className="sr-only">Open ban actions</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem onSelect={() => openEditDialog(ban)}>
                                Edit Ban
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => openDeleteDialog([ban])}
                              >
                                Remove Ban
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        <TableCell
                          className="max-w-[22rem] truncate"
                          title={targetText}
                        >
                          {targetText || "—"}
                        </TableCell>
                        <TableCell
                          className="max-w-[16rem] truncate"
                          title={ban.reason ?? ""}
                        >
                          {ban.reason || "—"}
                        </TableCell>
                        <TableCell>{getBanExpiryDisplay(ban) || "—"}</TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      className="h-32 text-center text-muted-foreground"
                      colSpan={5}
                    >
                      No bans found.
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
              {totalBans === 0
                ? "0-0 of 0"
                : `${pageStartIndex + 1}-${pageEndIndex} of ${totalBans}`}
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
        title="Add Ban"
        footer={
          <>
            <Button
              disabled={creating || (!form.ip && !form.name && !form.uid)}
              type="button"
              onClick={createBan}
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
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ban-ip">IP</Label>
            <Input
              id="ban-ip"
              disabled={creating}
              value={form.ip}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  ip: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ban-name">Name</Label>
            <Input
              id="ban-name"
              disabled={creating}
              value={form.name}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  name: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ban-uid">Unique ID</Label>
            <Input
              id="ban-uid"
              disabled={creating}
              value={form.uid}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  uid: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ban-reason">Reason</Label>
            <Textarea
              id="ban-reason"
              className="min-h-24 resize-y"
              disabled={creating}
              value={form.reason}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  reason: event.target.value,
                }))
              }
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <div className="space-y-2">
              <Label htmlFor="ban-duration">Duration</Label>
              <Input
                id="ban-duration"
                disabled={creating || form.unit === "0"}
                min={0}
                type="number"
                value={form.time}
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    time: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <AppSelect
                disabled={creating}
                options={timeUnitOptions}
                value={form.unit}
                onChange={(value) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    unit: value,
                  }))
                }
              />
            </div>
          </div>
        </div>
      </AppModal>

      <AppModal
        open={editDialogOpen}
        preventClose={creating}
        title="Edit Ban"
        footer={
          <>
            <Button
              disabled={creating || (!form.ip && !form.name && !form.uid)}
              type="button"
              onClick={editBan}
            >
              {creating ? "Saving..." : "Save"}
            </Button>
            <Button
              disabled={creating}
              type="button"
              variant="outline"
              onClick={closeEditDialog}
            >
              Cancel
            </Button>
          </>
        }
        onClose={closeEditDialog}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-ban-ip">IP</Label>
            <Input
              id="edit-ban-ip"
              disabled={creating}
              value={form.ip}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  ip: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-ban-name">Name</Label>
            <Input
              id="edit-ban-name"
              disabled={creating}
              value={form.name}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  name: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-ban-uid">Unique ID</Label>
            <Input
              id="edit-ban-uid"
              disabled={creating}
              value={form.uid}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  uid: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-ban-reason">Reason</Label>
            <Textarea
              id="edit-ban-reason"
              className="min-h-24 resize-y"
              disabled={creating}
              value={form.reason}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  reason: event.target.value,
                }))
              }
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <div className="space-y-2">
              <Label htmlFor="edit-ban-duration">Duration</Label>
              <Input
                id="edit-ban-duration"
                disabled={creating || form.unit === "0"}
                min={0}
                type="number"
                value={form.time}
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    time: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <AppSelect
                disabled={creating}
                options={timeUnitOptions}
                value={form.unit}
                onChange={(value) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    unit: value,
                  }))
                }
              />
            </div>
          </div>
        </div>
      </AppModal>

      <AppModal
        open={deleteDialogOpen}
        preventClose={deleting}
        title={bansToDelete.length > 1 ? "Delete Bans" : "Delete Ban"}
        footer={
          <>
            <Button
              disabled={deleting}
              type="button"
              variant="destructive"
              onClick={confirmDeleteBans}
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
          {bansToDelete.length > 1
            ? `Do you really want to delete the selected ${bansToDelete.length} bans?`
            : "Do you really want to delete this ban?"}
        </p>
      </AppModal>
    </div>
  )
}
