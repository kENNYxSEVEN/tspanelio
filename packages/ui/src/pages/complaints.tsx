import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type ComplaintRow = {
  fcldbid: string | number
  fname?: string | null
  message?: string | null
  tcldbid: string | number
  timestamp?: string | number
  tname?: string | null
  [key: string]: unknown
}

type PageSize = "25" | "50" | "75" | "all"
type SortDirection = "asc" | "desc"
type SortKey = "target" | "from" | "reason"

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

function getComplaintKey(complaint: ComplaintRow) {
  return [
    complaint.timestamp ?? "",
    complaint.tcldbid,
    complaint.fcldbid,
    complaint.message ?? "",
  ].join(":")
}

function getTargetName(complaint: ComplaintRow) {
  return complaint.tname || String(complaint.tcldbid)
}

function getFromName(complaint: ComplaintRow) {
  return complaint.fname || String(complaint.fcldbid)
}

export function Complaints() {
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const queryUserRef = useRef(queryUser)
  const selectServerFlightRef = useRef<ReturnType<
    typeof TeamSpeak.useServer
  > | null>(null)
  const loadComplaintsFlightRef = useRef<Promise<void> | null>(null)
  const { dismissToast, showError, showSuccess, toasts } = useToastStack()
  const [complaints, setComplaints] = useState<ComplaintRow[]>([])
  const [selectedComplaintKeys, setSelectedComplaintKeys] = useState<string[]>(
    [],
  )
  const [complaintsToDelete, setComplaintsToDelete] = useState<ComplaintRow[]>(
    [],
  )
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
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

  const selectedComplaintKeySet = useMemo(
    () => new Set(selectedComplaintKeys),
    [selectedComplaintKeys],
  )

  const selectedRows = useMemo(
    () =>
      complaints.filter((complaint) =>
        selectedComplaintKeySet.has(getComplaintKey(complaint)),
      ),
    [complaints, selectedComplaintKeySet],
  )

  const getSortValue = useCallback((complaint: ComplaintRow, key: SortKey) => {
    switch (key) {
      case "from":
        return getFromName(complaint)
      case "reason":
        return complaint.message ?? ""
      case "target":
        return getTargetName(complaint)
    }
  }, [])

  const sortedComplaints = useMemo(() => {
    if (!sortKey) {
      return complaints
    }

    const directionMultiplier = sortDirection === "asc" ? 1 : -1

    return [...complaints].sort(
      (firstComplaint, secondComplaint) =>
        compareTextValues(
          String(getSortValue(firstComplaint, sortKey)),
          String(getSortValue(secondComplaint, sortKey)),
        ) * directionMultiplier,
    )
  }, [complaints, getSortValue, sortDirection, sortKey])

  const totalComplaints = sortedComplaints.length
  const numericPageSize =
    pageSize === "all" ? Math.max(totalComplaints, 1) : Number(pageSize)
  const totalPages =
    pageSize === "all"
      ? 1
      : Math.max(1, Math.ceil(totalComplaints / numericPageSize))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const pageStartIndex =
    totalComplaints === 0 ? 0 : (safeCurrentPage - 1) * numericPageSize
  const pageEndIndex =
    pageSize === "all"
      ? totalComplaints
      : Math.min(totalComplaints, pageStartIndex + numericPageSize)
  const visibleComplaints = useMemo(
    () =>
      pageSize === "all"
        ? sortedComplaints
        : sortedComplaints.slice(pageStartIndex, pageEndIndex),
    [pageEndIndex, pageSize, pageStartIndex, sortedComplaints],
  )
  const visibleComplaintKeySet = useMemo(
    () =>
      new Set(
        visibleComplaints.map((complaint) => getComplaintKey(complaint)),
      ),
    [visibleComplaints],
  )
  const allVisibleSelected =
    visibleComplaints.length > 0 &&
    visibleComplaints.every((complaint) =>
      selectedComplaintKeySet.has(getComplaintKey(complaint)),
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

  const loadComplaints = useCallback(
    async (progress: "foreground" | "background" = "foreground") => {
      if (!loadComplaintsFlightRef.current) {
        loadComplaintsFlightRef.current = (async () => {
          await ensureSelectedServer()

          try {
            const complaintList = await TeamSpeak.execute<ComplaintRow[]>(
              "complainlist",
              {},
              [],
              { progress },
            )

            setComplaints(Array.isArray(complaintList) ? complaintList : [])
          } catch (error) {
            if (isDatabaseEmptyResult(error)) {
              setComplaints([])
            } else {
              throw error
            }
          }

          setSelectedComplaintKeys([])
          setCurrentPage(1)
        })().finally(() => {
          loadComplaintsFlightRef.current = null
        })
      }

      return loadComplaintsFlightRef.current
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
    loadComplaints()
      .catch((error: unknown) => {
        if (active) showError(getErrorMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [loadComplaints, selectedServerId, showError])

  const openDeleteDialog = (rows: ComplaintRow[]) => {
    setComplaintsToDelete(rows)
    setDeleteDialogOpen(true)
  }

  const closeDeleteDialog = () => {
    if (deleting) {
      return
    }

    setDeleteDialogOpen(false)
    setComplaintsToDelete([])
  }

  const confirmDeleteComplaints = async () => {
    if (!complaintsToDelete.length) {
      setDeleteDialogOpen(false)
      return
    }

    setDeleting(true)

    try {
      await ensureSelectedServer()

      for (const complaint of complaintsToDelete) {
        await TeamSpeak.execute("complaindel", {
          fcldbid: complaint.fcldbid,
          tcldbid: complaint.tcldbid,
        })
      }

      showSuccess(
        complaintsToDelete.length === 1
          ? "Complaint deleted"
          : "Complaints deleted",
      )
      setDeleteDialogOpen(false)
      setComplaintsToDelete([])
      await loadComplaints("background")
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  const toggleComplaintSelection = (
    complaintKey: string,
    selected: boolean,
  ) => {
    setSelectedComplaintKeys((currentKeys) =>
      selected
        ? [...new Set([...currentKeys, complaintKey])]
        : currentKeys.filter((currentKey) => currentKey !== complaintKey),
    )
  }

  const toggleAllVisibleComplaints = (selected: boolean) => {
    setSelectedComplaintKeys((currentKeys) => {
      if (!selected) {
        return currentKeys.filter((key) => !visibleComplaintKeySet.has(key))
      }

      return [
        ...new Set([
          ...currentKeys,
          ...visibleComplaints.map((complaint) => getComplaintKey(complaint)),
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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Card>
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
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="space-y-2 px-3 pb-3 md:hidden">
            {loading ? (
              <div className="rounded-md border p-4 text-center text-sm text-muted-foreground">
                ...loading
              </div>
            ) : visibleComplaints.length ? (
              visibleComplaints.map((complaint) => {
                const complaintKey = getComplaintKey(complaint)
                const selected = selectedComplaintKeySet.has(complaintKey)
                const targetName = getTargetName(complaint)
                const fromName = getFromName(complaint)
                const reason = complaint.message ?? ""

                return (
                  <div
                    className="rounded-md border p-3 text-sm"
                    data-state={selected ? "selected" : undefined}
                    key={complaintKey}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(checked) =>
                          toggleComplaintSelection(
                            complaintKey,
                            checked === true,
                          )
                        }
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div
                            className="min-w-0 truncate font-medium"
                            title={targetName}
                          >
                            {targetName}
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
                                  Open complaint actions
                                </span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="w-fit min-w-0 max-w-[18rem]"
                            >
                              <DropdownMenuItem asChild>
                                <Link
                                  className="flex min-w-0 max-w-[16rem] items-center"
                                  title={`Ban ${targetName}`}
                                  to={`/client/${complaint.tcldbid}/ban`}
                                >
                                  <span className="block min-w-0 truncate">
                                    Ban {targetName}
                                  </span>
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link
                                  className="flex min-w-0 max-w-[16rem] items-center"
                                  title={`Ban ${fromName}`}
                                  to={`/client/${complaint.fcldbid}/ban`}
                                >
                                  <span className="block min-w-0 truncate">
                                    Ban {fromName}
                                  </span>
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="whitespace-nowrap"
                                variant="destructive"
                                onSelect={() => openDeleteDialog([complaint])}
                              >
                                Remove Complaint
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <div className="grid gap-2 text-xs">
                          <div className="flex items-start justify-between gap-3">
                            <span className="shrink-0 text-muted-foreground">
                              From Nickname
                            </span>
                            <span className="min-w-0 break-words text-right">
                              {fromName}
                            </span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="shrink-0 text-muted-foreground">
                              Reason
                            </span>
                            <span className="min-w-0 break-words text-right">
                              {reason ? `"${reason}"` : "-"}
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
                No complaints found.
              </div>
            )}
          </div>
          <div className="hidden max-w-full overflow-x-auto px-3 pb-2 sm:px-6 md:block">
            <Table className="w-full min-w-[680px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allVisibleSelected}
                      disabled={!visibleComplaints.length}
                      onCheckedChange={(checked) =>
                        toggleAllVisibleComplaints(checked === true)
                      }
                    />
                  </TableHead>
                  <TableHead className="w-10" />
                  {renderSortableHead(
                    "target",
                    "Target Nickname",
                    "min-w-[12rem]",
                  )}
                  {renderSortableHead(
                    "from",
                    "From Nickname",
                    "min-w-[12rem]",
                  )}
                  {renderSortableHead("reason", "Reason", "min-w-[18rem]")}
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
                ) : complaints.length ? (
                  visibleComplaints.map((complaint) => {
                    const complaintKey = getComplaintKey(complaint)
                    const selected = selectedComplaintKeySet.has(complaintKey)
                    const targetName = getTargetName(complaint)
                    const fromName = getFromName(complaint)
                    const reason = complaint.message ?? ""

                    return (
                      <TableRow
                        data-state={selected ? "selected" : undefined}
                        key={complaintKey}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(checked) =>
                              toggleComplaintSelection(
                                complaintKey,
                                checked === true,
                              )
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
                                  Open complaint actions
                                </span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="start"
                              className="w-fit min-w-0 max-w-[18rem]"
                            >
                              <DropdownMenuItem asChild>
                                <Link
                                  className="flex min-w-0 max-w-[16rem] items-center"
                                  title={`Ban ${targetName}`}
                                  to={`/client/${complaint.tcldbid}/ban`}
                                >
                                  <span className="block min-w-0 truncate">
                                    Ban {targetName}
                                  </span>
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link
                                  className="flex min-w-0 max-w-[16rem] items-center"
                                  title={`Ban ${fromName}`}
                                  to={`/client/${complaint.fcldbid}/ban`}
                                >
                                  <span className="block min-w-0 truncate">
                                    Ban {fromName}
                                  </span>
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="whitespace-nowrap"
                                variant="destructive"
                                onSelect={() => openDeleteDialog([complaint])}
                              >
                                Remove Complaint
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        <TableCell
                          className="max-w-[14rem] truncate"
                          title={targetName}
                        >
                          {targetName}
                        </TableCell>
                        <TableCell
                          className="max-w-[14rem] truncate"
                          title={fromName}
                        >
                          {fromName}
                        </TableCell>
                        <TableCell
                          className="max-w-[24rem] truncate italic"
                          title={reason}
                        >
                          {reason ? `"${reason}"` : "-"}
                        </TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      className="h-32 text-center text-muted-foreground"
                      colSpan={5}
                    >
                      No complaints found.
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
              {totalComplaints === 0
                ? "0-0 of 0"
                : `${pageStartIndex + 1}-${pageEndIndex} of ${totalComplaints}`}
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
        title={
          complaintsToDelete.length === 1
            ? "Delete Complaint"
            : "Delete Complaints"
        }
        footer={
          <>
            <Button
              disabled={deleting}
              type="button"
              variant="destructive"
              onClick={confirmDeleteComplaints}
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
          {complaintsToDelete.length === 1
            ? "Do you really want to delete this complaint?"
            : `Do you really want to delete ${complaintsToDelete.length} complaints?`}
        </p>
      </AppModal>
    </div>
  )
}
