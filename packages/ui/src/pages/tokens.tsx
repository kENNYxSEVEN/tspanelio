import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  MoreVertical,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { copyTextToClipboard } from "@/lib/clipboard"

type TokenType = "0" | "1"

type TokenRow = {
  token: string
  tokenCreated?: string | number
  tokenDescription?: string
  tokenId1?: string | number
  tokenId2?: string | number
  tokenType?: string | number
  [key: string]: unknown
}

type ServerGroupRow = {
  name?: string
  sgid?: string | number
  type?: string | number
  [key: string]: unknown
}

type ChannelGroupRow = {
  cgid?: string | number
  name?: string
  type?: string | number
  [key: string]: unknown
}

type ChannelRow = {
  channelName?: string
  cid?: string | number
  [key: string]: unknown
}

type CreateTokenForm = {
  tokenDescription: string
  tokenType: TokenType | ""
  selectedChannel: string
  selectedGroup: string
}

type PageSize = "25" | "50" | "75" | "all"
type SortDirection = "asc" | "desc"
type SortKey = "token" | "type" | "group" | "channel" | "created" | "description"

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

function normalizeTokenType(type: string | number | undefined) {
  if (String(type) === "0") {
    return "Server Group"
  }

  if (String(type) === "1") {
    return "Channel Group"
  }

  return String(type ?? "")
}

function formatCreatedDate(value: string | number | undefined) {
  if (value === undefined || value === "") {
    return ""
  }

  const timestamp = Number(value)

  if (!Number.isFinite(timestamp)) {
    return String(value)
  }

  return new Date(timestamp * 1000).toLocaleString()
}

function isRegularGroup(group: { type?: string | number }) {
  return String(group.type) === "1"
}

function getServerGroupLabel(group: ServerGroupRow) {
  return group.name ?? `Server Group ${String(group.sgid ?? "")}`
}

function getChannelGroupLabel(group: ChannelGroupRow) {
  return group.name ?? `Channel Group ${String(group.cgid ?? "")}`
}

function getChannelLabel(channel: ChannelRow) {
  return channel.channelName ?? `Channel ${String(channel.cid ?? "")}`
}

function getCreatedTimestamp(value: string | number | undefined) {
  const timestamp = Number(value)

  return Number.isFinite(timestamp) ? timestamp : 0
}

function compareTextValues(firstValue: string, secondValue: string) {
  return firstValue.localeCompare(secondValue, undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

export function Tokens() {
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const queryUserRef = useRef(queryUser)
  const selectServerFlightRef = useRef<ReturnType<
    typeof TeamSpeak.useServer
  > | null>(null)
  const { dismissToast, showError, showInfo, showSuccess, toasts } =
    useToastStack()
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [selectedTokens, setSelectedTokens] = useState<string[]>([])
  const [serverGroups, setServerGroups] = useState<ServerGroupRow[]>([])
  const [channelGroups, setChannelGroups] = useState<ChannelGroupRow[]>([])
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [form, setForm] = useState<CreateTokenForm>({
    selectedChannel: "",
    selectedGroup: "",
    tokenDescription: "",
    tokenType: "",
  })
  const [createdToken, setCreatedToken] = useState("")
  const [addTokenDialogOpen, setAddTokenDialogOpen] = useState(false)
  const [loadingTokens, setLoadingTokens] = useState(true)
  const [pageSize, setPageSize] = useState<PageSize>("25")
  const [currentPage, setCurrentPage] = useState(1)
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [loadingFormData, setLoadingFormData] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [tokensToDelete, setTokensToDelete] = useState<TokenRow[]>([])

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

  const tokenTypeOptions = [
    { label: "Server Group", value: "0" },
    { label: "Channel Group", value: "1" },
  ]

  const pageSizeOptions = [
    { label: "25", value: "25" },
    { label: "50", value: "50" },
    { label: "75", value: "75" },
    { label: "All", value: "all" },
  ]

  const serverGroupOptions = serverGroups.map((group) => ({
    label: getServerGroupLabel(group),
    value: String(group.sgid ?? ""),
  }))

  const channelGroupOptions = channelGroups.map((group) => ({
    label: getChannelGroupLabel(group),
    value: String(group.cgid ?? ""),
  }))

  const channelOptions = channels.map((channel) => ({
    label: getChannelLabel(channel),
    value: String(channel.cid ?? ""),
  }))

  const serverGroupNameById = useMemo(
    () =>
      new Map(
        serverGroups.map((group) => [
          String(group.sgid ?? ""),
          getServerGroupLabel(group),
        ]),
      ),
    [serverGroups],
  )

  const channelGroupNameById = useMemo(
    () =>
      new Map(
        channelGroups.map((group) => [
          String(group.cgid ?? ""),
          getChannelGroupLabel(group),
        ]),
      ),
    [channelGroups],
  )

  const channelNameById = useMemo(
    () =>
      new Map(
        channels.map((channel) => [
          String(channel.cid ?? ""),
          getChannelLabel(channel),
        ]),
      ),
    [channels],
  )

  const currentGroupOptions =
    form.tokenType === "1" ? channelGroupOptions : serverGroupOptions

  const selectedTokenSet = useMemo(
    () => new Set(selectedTokens),
    [selectedTokens],
  )

  const selectedRows = useMemo(
    () => tokens.filter((token) => selectedTokenSet.has(token.token)),
    [selectedTokenSet, tokens],
  )

  const getTokenGroupDisplay = (token: TokenRow) => {
    const groupId = String(token.tokenId1 ?? "")

    if (!groupId) {
      return ""
    }

    if (String(token.tokenType) === "1") {
      return channelGroupNameById.get(groupId) ?? groupId
    }

    return serverGroupNameById.get(groupId) ?? groupId
  }

  const getTokenChannelDisplay = (token: TokenRow) => {
    if (String(token.tokenType) !== "1") {
      return "—"
    }

    const channelId = String(token.tokenId2 ?? "")

    if (!channelId) {
      return ""
    }

    return channelNameById.get(channelId) ?? channelId
  }

  const getSortValue = useCallback(
    (token: TokenRow, key: SortKey) => {
      switch (key) {
        case "channel":
          return getTokenChannelDisplay(token)
        case "created":
          return getCreatedTimestamp(token.tokenCreated)
        case "description":
          return token.tokenDescription ?? ""
        case "group":
          return getTokenGroupDisplay(token)
        case "token":
          return token.token
        case "type":
          return normalizeTokenType(token.tokenType)
      }
    },
    [channelGroupNameById, channelNameById, serverGroupNameById],
  )

  const sortedTokens = useMemo(() => {
    if (!sortKey) {
      return tokens
    }

    const directionMultiplier = sortDirection === "asc" ? 1 : -1

    return [...tokens].sort((firstToken, secondToken) => {
      const firstValue = getSortValue(firstToken, sortKey)
      const secondValue = getSortValue(secondToken, sortKey)

      if (typeof firstValue === "number" && typeof secondValue === "number") {
        return (firstValue - secondValue) * directionMultiplier
      }

      return (
        compareTextValues(String(firstValue), String(secondValue)) *
        directionMultiplier
      )
    })
  }, [getSortValue, sortDirection, sortKey, tokens])

  const totalTokens = sortedTokens.length
  const numericPageSize = pageSize === "all" ? Math.max(totalTokens, 1) : Number(pageSize)
  const totalPages =
    pageSize === "all" ? 1 : Math.max(1, Math.ceil(totalTokens / numericPageSize))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const pageStartIndex = totalTokens === 0 ? 0 : (safeCurrentPage - 1) * numericPageSize
  const pageEndIndex =
    pageSize === "all" ? totalTokens : Math.min(totalTokens, pageStartIndex + numericPageSize)
  const visibleTokens = useMemo(
    () =>
      pageSize === "all"
        ? sortedTokens
        : sortedTokens.slice(pageStartIndex, pageEndIndex),
    [pageEndIndex, pageSize, pageStartIndex, sortedTokens],
  )
  const visibleTokenSet = useMemo(
    () => new Set(visibleTokens.map((token) => token.token)),
    [visibleTokens],
  )
  const allVisibleSelected =
    visibleTokens.length > 0 &&
    visibleTokens.every((token) => selectedTokenSet.has(token.token))

  const handleSort = (key: SortKey) => {
    setCurrentPage(1)

    if (sortKey === key) {
      setSortDirection((currentDirection) =>
        currentDirection === "asc" ? "desc" : "asc",
      )
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

  const loadTokens = useCallback(
    async (progress: "foreground" | "background" = "foreground") => {
      await ensureSelectedServer()
      const tokenList = await TeamSpeak.execute<TokenRow[]>(
        "tokenlist",
        {},
        [],
        { progress },
      )

      setTokens(Array.isArray(tokenList) ? tokenList : [])
      setSelectedTokens([])
      setCurrentPage(1)
    },
    [ensureSelectedServer],
  )

  useEffect(() => {
    let active = true

    if (!isUsableServerId(selectedServerId)) {
      setLoadingTokens(false)
      return () => {
        active = false
      }
    }

    setLoadingTokens(true)
    loadTokens()
      .catch((error: unknown) => {
        if (active) showError(getErrorMessage(error))
      })
      .finally(() => {
        if (active) setLoadingTokens(false)
      })

    return () => {
      active = false
    }
  }, [loadTokens, selectedServerId, showError])


  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(page, 1), totalPages))
  }, [totalPages])

  const loadServerGroups = useCallback(async () => {
    if (serverGroups.length) {
      return serverGroups
    }

    await ensureSelectedServer()
    const groups = await TeamSpeak.execute<ServerGroupRow[]>(
      "servergrouplist",
      {},
      [],
      { progress: "background" },
    )
    const regularGroups = groups.filter(isRegularGroup)

    setServerGroups(regularGroups)
    return regularGroups
  }, [ensureSelectedServer, serverGroups])

  const loadChannelGroupsAndChannels = useCallback(async () => {
    await ensureSelectedServer()

    const [groupList, channelList] = await Promise.all([
      channelGroups.length
        ? Promise.resolve(channelGroups)
        : TeamSpeak.execute<ChannelGroupRow[]>(
            "channelgrouplist",
            {},
            [],
            { progress: "background" },
          ).then((groups) => groups.filter(isRegularGroup)),
      channels.length
        ? Promise.resolve(channels)
        : TeamSpeak.execute<ChannelRow[]>(
            "channellist",
            {},
            [],
            { progress: "background" },
          ),
    ])

    setChannelGroups(groupList)
    setChannels(channelList)
    return { channelList, groupList }
  }, [channelGroups, channels, ensureSelectedServer])

  const loadTokenLookups = useCallback(async () => {
    if (serverGroups.length && channelGroups.length && channels.length) {
      return
    }

    await ensureSelectedServer()

    const [nextServerGroups, nextChannelGroups, nextChannels] = await Promise.all([
      serverGroups.length
        ? Promise.resolve(serverGroups)
        : TeamSpeak.execute<ServerGroupRow[]>(
            "servergrouplist",
            {},
            [],
            { progress: "background" },
          ).then((groups) => groups.filter(isRegularGroup)),
      channelGroups.length
        ? Promise.resolve(channelGroups)
        : TeamSpeak.execute<ChannelGroupRow[]>(
            "channelgrouplist",
            {},
            [],
            { progress: "background" },
          ).then((groups) => groups.filter(isRegularGroup)),
      channels.length
        ? Promise.resolve(channels)
        : TeamSpeak.execute<ChannelRow[]>(
            "channellist",
            {},
            [],
            { progress: "background" },
          ),
    ])

    setServerGroups(nextServerGroups)
    setChannelGroups(nextChannelGroups)
    setChannels(nextChannels)
  }, [
    channelGroups,
    channels,
    ensureSelectedServer,
    serverGroups,
  ])

  useEffect(() => {
    if (!isUsableServerId(selectedServerId)) {
      return
    }

    void loadTokenLookups().catch((error: unknown) => {
      showError(getErrorMessage(error))
    })
  }, [loadTokenLookups, selectedServerId, showError])

  const handleTokenTypeChange = async (nextType: string) => {
    if (nextType !== "0" && nextType !== "1") {
      return
    }

    setForm((currentForm) => ({
      ...currentForm,
      selectedChannel: "",
      selectedGroup: "",
      tokenType: nextType,
    }))
    setCreatedToken("")
    setLoadingFormData(true)

    try {
      if (nextType === "0") {
        const groups = await loadServerGroups()

        setForm((currentForm) => ({
          ...currentForm,
          selectedGroup: String(groups[0]?.sgid ?? ""),
        }))
      } else {
        const { channelList, groupList } = await loadChannelGroupsAndChannels()

        setForm((currentForm) => ({
          ...currentForm,
          selectedChannel: String(channelList[0]?.cid ?? ""),
          selectedGroup: String(groupList[0]?.cgid ?? ""),
        }))
      }
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setLoadingFormData(false)
    }
  }


  const copyToken = async (token: string) => {
    try {
      await copyTextToClipboard(token)
      showInfo("Token Copied To Clipboard")
    } catch (error) {
      showError(getErrorMessage(error))
    }
  }


  const resetCreateForm = () => {
    setForm({
      selectedChannel: "",
      selectedGroup: "",
      tokenDescription: "",
      tokenType: "",
    })
    setCreatedToken("")
  }

  const openAddTokenDialog = () => {
    resetCreateForm()
    setAddTokenDialogOpen(true)
  }

  const closeAddTokenDialog = () => {
    if (creating) {
      return
    }

    setAddTokenDialogOpen(false)
    resetCreateForm()
  }

  const openDeleteDialog = (rows: TokenRow[]) => {
    setTokensToDelete(rows)
    setDeleteDialogOpen(true)
  }

  const confirmDeleteTokens = async () => {
    if (!tokensToDelete.length) {
      setDeleteDialogOpen(false)
      return
    }

    setDeleting(true)

    try {
      await ensureSelectedServer()

      for (const token of tokensToDelete) {
        await TeamSpeak.execute("tokendelete", { token: token.token })
      }

      showSuccess(
        tokensToDelete.length === 1
          ? "Token deleted"
          : "Tokens deleted",
      )
      setDeleteDialogOpen(false)
      setTokensToDelete([])
      await loadTokens("background")
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  const createToken = async () => {
    if (!form.tokenType || !form.selectedGroup) {
      showError("Select a token type and group first.")
      return
    }

    if (form.tokenType === "1" && !form.selectedChannel) {
      showError("Select a channel first.")
      return
    }

    setCreating(true)

    try {
      await ensureSelectedServer()

      const response = await TeamSpeak.execute<TokenRow[]>("tokenadd", {
        tokendescription: form.tokenDescription,
        tokenid1: form.selectedGroup,
        tokenid2: form.tokenType === "1" ? form.selectedChannel : 0,
        tokentype: Number(form.tokenType),
      })
      const nextToken = response[0]?.token

      if (nextToken) {
        setCreatedToken(nextToken)
      }

      showSuccess("Token successfully created")
      await loadTokens("background")
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setCreating(false)
    }
  }

  const toggleTokenSelection = (token: string, selected: boolean) => {
    setSelectedTokens((currentTokens) =>
      selected
        ? [...new Set([...currentTokens, token])]
        : currentTokens.filter((currentToken) => currentToken !== token),
    )
  }

  const toggleAllTokens = (selected: boolean) => {
    setSelectedTokens((currentTokens) => {
      if (!selected) {
        return currentTokens.filter((token) => !visibleTokenSet.has(token))
      }

      return [
        ...new Set([
          ...currentTokens,
          ...visibleTokens.map((token) => token.token),
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
    <div className="flex w-full max-w-none flex-col gap-5">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={openAddTokenDialog}>
              <Plus className="size-4" />
              Add Token
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
            {loadingTokens ? (
              <div className="rounded-md border p-4 text-center text-sm text-muted-foreground">
                ...loading
              </div>
            ) : visibleTokens.length ? (
              visibleTokens.map((token) => {
                const selected = selectedTokenSet.has(token.token)
                const groupDisplay = getTokenGroupDisplay(token)
                const channelDisplay = getTokenChannelDisplay(token)
                const title = groupDisplay || token.token

                return (
                  <div
                    className="rounded-md border p-3 text-sm"
                    data-state={selected ? "selected" : undefined}
                    key={token.token}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(checked) =>
                          toggleTokenSelection(token.token, checked === true)
                        }
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div
                              className="truncate font-medium"
                              title={title}
                            >
                              {title}
                            </div>
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
                                  Open token actions
                                </span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => openDeleteDialog([token])}
                              >
                                Delete Token
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => void copyToken(token.token)}
                              >
                                Copy Token
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <code
                          className="inline-block max-w-full truncate rounded bg-muted px-2 py-1 align-top font-mono text-[11px]"
                          title={token.token}
                        >
                          {token.token}
                        </code>
                        <div className="grid gap-2 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Type</span>
                            <span className="text-right">
                              {normalizeTokenType(token.tokenType)}
                            </span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="shrink-0 text-muted-foreground">
                              Group
                            </span>
                            <span className="min-w-0 break-words text-right">
                              {groupDisplay}
                            </span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="shrink-0 text-muted-foreground">
                              Channel
                            </span>
                            <span className="min-w-0 break-words text-right">
                              {channelDisplay}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Created</span>
                            <span className="text-right">
                              {formatCreatedDate(token.tokenCreated)}
                            </span>
                          </div>
                          {token.tokenDescription ? (
                            <div className="flex items-start justify-between gap-3 text-xs">
                              <span className="shrink-0 text-muted-foreground">Description</span>
                              <span
                                className="min-w-0 max-w-[44vw] truncate text-right"
                                title={token.tokenDescription || ""}
                              >
                                {token.tokenDescription || "—"}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="rounded-md border p-4 text-center text-sm text-muted-foreground">
                No tokens found.
              </div>
            )}
          </div>
          <div className="hidden max-w-full overflow-x-auto px-3 pb-2 sm:px-6 md:block">
            <Table className="w-full min-w-[1350px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allVisibleSelected}
                      disabled={!visibleTokens.length}
                      onCheckedChange={(checked) =>
                        toggleAllTokens(checked === true)
                      }
                    />
                  </TableHead>
                  <TableHead className="w-10" />
                  {renderSortableHead("token", "Privilege Key", "min-w-[22rem]")}
                  {renderSortableHead("type", "Type", "w-36")}
                  {renderSortableHead("group", "Group", "min-w-[12rem]")}
                  {renderSortableHead("channel", "Channel", "min-w-[14rem]")}
                  {renderSortableHead("created", "Created", "w-48")}
                  {renderSortableHead("description", "Description", "min-w-[24rem]")}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingTokens ? (
                  <TableRow>
                    <TableCell
                      className="h-32 text-center text-muted-foreground"
                      colSpan={8}
                    >
                      ...loading
                    </TableCell>
                  </TableRow>
                ) : tokens.length ? (
                  visibleTokens.map((token) => {
                    const selected = selectedTokenSet.has(token.token)

                    return (
                      <TableRow
                        key={token.token}
                        data-state={selected ? "selected" : undefined}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(checked) =>
                              toggleTokenSelection(token.token, checked === true)
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
                                <span className="sr-only">Open token actions</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => openDeleteDialog([token])}
                              >
                                Delete Token
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => void copyToken(token.token)}
                              >
                                Copy Token
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        <TableCell>
                          <code
                            className="inline-flex max-w-full select-all items-center truncate rounded bg-muted px-2 py-1 font-mono text-xs leading-none"
                            title={token.token}
                          >
                            {token.token}
                          </code>
                        </TableCell>
                        <TableCell>{normalizeTokenType(token.tokenType)}</TableCell>
                        <TableCell
                          className="max-w-[12rem] truncate"
                          title={getTokenGroupDisplay(token)}
                        >
                          {getTokenGroupDisplay(token)}
                        </TableCell>
                        <TableCell
                          className="max-w-[14rem] truncate"
                          title={getTokenChannelDisplay(token)}
                        >
                          {getTokenChannelDisplay(token)}
                        </TableCell>
                        <TableCell>{formatCreatedDate(token.tokenCreated)}</TableCell>
                        <TableCell
                          className="max-w-[18rem] truncate"
                          title={token.tokenDescription ?? ""}
                        >
                          {token.tokenDescription ?? ""}
                        </TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      className="h-32 text-center text-muted-foreground"
                      colSpan={8}
                    >
                      No tokens found.
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
                    if (value === "25" || value === "50" || value === "75" || value === "all") {
                      setPageSize(value)
                      setCurrentPage(1)
                    }
                  }}
                />
              </div>
            </div>
            <div className="min-w-[6.5rem] text-right text-foreground">
              {totalTokens === 0
                ? "0-0 of 0"
                : `${pageStartIndex + 1}-${pageEndIndex} of ${totalTokens}`}
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
        open={addTokenDialogOpen}
        preventClose={creating}
        title="Add Token"
        footer={
          <>
            <Button
              disabled={creating || loadingFormData || !form.tokenType}
              type="button"
              onClick={createToken}
            >
              {creating ? "Creating..." : "Create"}
            </Button>
            <Button
              disabled={creating}
              type="button"
              variant="outline"
              onClick={closeAddTokenDialog}
            >
              Close
            </Button>
          </>
        }
        onClose={closeAddTokenDialog}
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Type</Label>
            <AppSelect
              disabled={creating || loadingFormData}
              options={tokenTypeOptions}
              placeholder="Select type"
              value={form.tokenType}
              onChange={handleTokenTypeChange}
            />
          </div>

          <div className="space-y-2">
            <Label>Group</Label>
            <AppSelect
              disabled={!form.tokenType || creating || loadingFormData}
              options={currentGroupOptions}
              placeholder={loadingFormData ? "Loading groups..." : "Select group"}
              value={form.selectedGroup}
              onChange={(value) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  selectedGroup: value,
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label>Channel</Label>
            <AppSelect
              disabled={form.tokenType !== "1" || creating || loadingFormData}
              options={channelOptions}
              placeholder={
                form.tokenType !== "1"
                  ? "Only for Channel Group tokens"
                  : loadingFormData
                    ? "Loading channels..."
                    : "Select channel"
              }
              value={form.tokenType === "1" ? form.selectedChannel : ""}
              onChange={(value) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  selectedChannel: value,
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="token-description">Description</Label>
            <Textarea
              id="token-description"
              className="min-h-28 resize-y"
              disabled={creating}
              value={form.tokenDescription}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  tokenDescription: event.target.value,
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label>Generated Privilege Key</Label>
            <div className="flex min-w-0 gap-2">
              <code className="flex min-h-10 min-w-0 flex-1 select-all items-center truncate rounded-lg border bg-muted px-3 font-mono text-xs">
                {createdToken || ""}
              </code>
              <Button
                disabled={!createdToken}
                size="icon"
                type="button"
                variant="outline"
                onClick={() => void copyToken(createdToken)}
              >
                <Copy className="size-4" />
                <span className="sr-only">Copy generated token</span>
              </Button>
            </div>
          </div>
        </div>
      </AppModal>

      <AppModal
        open={deleteDialogOpen}
        preventClose={deleting}
        title="Delete Token"
        footer={
          <>
            <Button
              disabled={deleting}
              type="button"
              variant="destructive"
              onClick={confirmDeleteTokens}
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
          Do you really want to delete this token?
        </p>
      </AppModal>
    </div>
  )
}
