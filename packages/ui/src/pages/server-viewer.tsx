import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react"
import { Link } from "react-router-dom"
import {
  ArrowRight,
  Ban,
  ChevronDown,
  ChevronRight,
  Edit,
  Hash,
  LockKeyhole,
  MessageSquare,
  Plus,
  RefreshCw,
  Trash2,
  UserRound,
  Zap,
} from "lucide-react"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth, type QueryUser } from "@/auth/auth-context"
import { AppModal } from "@/components/app-modal"
import { ClientStatusIcons } from "@/components/client-status-icons"
import { ToastStack, useToastStack } from "@/components/toast-stack"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { startLoading, stopLoading } from "@/lib/loading-progress"
import { cn } from "@/lib/utils"

type ServerInfo = {
  virtualserverName?: string
  [key: string]: unknown
}

type ChannelRow = {
  cid: string | number
  pid: string | number
  channelName: string
  channelTopic?: string
  totalClients?: string | number
  [key: string]: unknown
}

type ClientRow = {
  clid: string | number
  cid: string | number
  clientNickname: string
  clientDatabaseId?: string | number
  clientAway?: string | number
  clientAwayMessage?: string
  clientInputMuted?: string | number
  clientOutputMuted?: string | number
  [key: string]: unknown
}

type ChannelTreeItem = ChannelRow & {
  id: string
  itemId: string | number
  parentItemId: string | number
  children?: TreeItem[]
}

type ClientTreeItem = ClientRow & {
  id: string
  itemId: null
  parentItemId: string | number
}

type TreeItem = ChannelTreeItem | ClientTreeItem

type TreeMenuPosition = {
  left: number
  top: number
}

type ActiveTreeMenu =
  | {
      item: ChannelTreeItem
      position: TreeMenuPosition
      type: "channel"
    }
  | {
      item: ClientTreeItem
      position: TreeMenuPosition
      type: "client"
    }
  | null

const SERVER_VIEWER_CACHE_PREFIX = "tspanelio:server-viewer:"
const TREE_MENU_EDGE_GAP = 8
const CHANNEL_TREE_MENU_HEIGHT = 232
const CHANNEL_TREE_MENU_WIDTH = 208
const CLIENT_TREE_MENU_HEIGHT = 232
const CLIENT_TREE_MENU_WIDTH = 256

type ServerViewerLoadResult = {
  serverInfo: ServerInfo
  channelList: ChannelRow[]
  clientList: ClientRow[]
  queryUser?: QueryUser
}

type ServerViewerCache = {
  serverId?: string
  serverInfo: ServerInfo
  channelList: ChannelRow[]
  clientList: ClientRow[]
  queryUser?: QueryUser
  loaded: boolean
  lastLoadedAt?: number
}

const serverViewerCache: ServerViewerCache = {
  serverInfo: {},
  channelList: [],
  clientList: [],
  loaded: false,
}
const serverViewerLoadFlights = new Map<
  string,
  Promise<ServerViewerLoadResult>
>()
const channelTreeLoadFlights = new Map<
  string,
  Promise<ServerViewerLoadResult>
>()

function readServerViewerCache(serverId: string | undefined) {
  if (!serverId) {
    return undefined
  }

  try {
    const cachedValue = window.sessionStorage.getItem(
      SERVER_VIEWER_CACHE_PREFIX + serverId,
    )

    if (!cachedValue) {
      return undefined
    }

    const parsed = JSON.parse(cachedValue) as Partial<ServerViewerCache>

    if (
      !Array.isArray(parsed.channelList) ||
      !Array.isArray(parsed.clientList)
    ) {
      return undefined
    }

    return {
      serverId,
      serverInfo: parsed.serverInfo ?? {},
      channelList: parsed.channelList,
      clientList: parsed.clientList,
      queryUser: parsed.queryUser,
      loaded: true,
      lastLoadedAt: parsed.lastLoadedAt,
    } satisfies ServerViewerCache
  } catch {
    return undefined
  }
}

function writeServerViewerCache(cache: ServerViewerCache) {
  if (!cache.serverId) {
    return
  }

  try {
    window.sessionStorage.setItem(
      SERVER_VIEWER_CACHE_PREFIX + cache.serverId,
      JSON.stringify(cache),
    )
  } catch {
    // Ignore storage quota/privacy mode failures; in-memory cache still works.
  }
}

function getServerViewerCache(serverId: string | undefined) {
  if (
    serverId &&
    serverViewerCache.loaded &&
    serverViewerCache.serverId === serverId
  ) {
    return serverViewerCache
  }

  const persistedCache = readServerViewerCache(serverId)

  if (persistedCache) {
    Object.assign(serverViewerCache, persistedCache)
  }

  return persistedCache
}

type SpacerAlignment = "left" | "center" | "right"

type SpacerDisplay = {
  isSpacer: boolean
  label: string
  alignment: SpacerAlignment
}

type EventPayload = Record<string, unknown>
type ProgressMode = "foreground" | "background" | "none"
type ClientActionType = "poke" | "kick-channel" | "kick-server"
type ClientAction = {
  type: ClientActionType
  client: ClientTreeItem
} | null
type DeleteChannelAction = {
  channel: ChannelTreeItem
} | null

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

function valueOrDash(value: unknown) {
  return value === undefined || value === null || value === ""
    ? "-"
    : String(value)
}

function getChannelLabel(channel: ChannelRow) {
  return (
    formatChannelName(channel.channelName).label.trim() || channel.channelName
  )
}

function isUsableServerId(value: string | number | undefined | null) {
  return (
    value !== undefined &&
    value !== null &&
    String(value) !== "" &&
    String(value) !== "0"
  )
}

function getEventDetail(event: Event) {
  return event instanceof CustomEvent ? event.detail : undefined
}

function isRecord(value: unknown): value is EventPayload {
  return typeof value === "object" && value !== null
}

function findPayloadValue(payload: unknown, keys: string[]): unknown {
  if (!isRecord(payload)) {
    return undefined
  }

  for (const key of keys) {
    if (payload[key] !== undefined) {
      return payload[key]
    }
  }

  for (const value of Object.values(payload)) {
    const nestedValue = findPayloadValue(value, keys)

    if (nestedValue !== undefined) {
      return nestedValue
    }
  }

  return undefined
}

function normalizeEventId(value: unknown) {
  if (typeof value === "string" || typeof value === "number") {
    return value
  }

  return undefined
}

function findRecordWithKeys(
  payload: unknown,
  keys: string[],
): EventPayload | undefined {
  if (!isRecord(payload)) {
    return undefined
  }

  if (keys.some((key) => payload[key] !== undefined)) {
    return payload
  }

  for (const value of Object.values(payload)) {
    const nestedRecord = findRecordWithKeys(value, keys)

    if (nestedRecord) {
      return nestedRecord
    }
  }

  return undefined
}

function getMovedClientId(payload: unknown) {
  return normalizeEventId(
    findPayloadValue(payload, ["clid", "clientId", "client_id"]),
  )
}

function getTargetChannelId(payload: unknown) {
  return normalizeEventId(
    findPayloadValue(payload, ["ctid", "targetChannelId", "targetCid", "cid"]),
  )
}

function getConnectedClient(payload: unknown): ClientRow | undefined {
  const clientPayload = findRecordWithKeys(payload, ["clid", "clientId"])

  if (!clientPayload) {
    return undefined
  }

  const clid = normalizeEventId(
    findPayloadValue(clientPayload, ["clid", "clientId", "client_id"]),
  )
  const cid = getTargetChannelId(clientPayload)

  if (clid === undefined || cid === undefined) {
    return undefined
  }

  const nickname = findPayloadValue(clientPayload, [
    "clientNickname",
    "nickname",
    "client_nickname",
  ])
  const clientDatabaseId = normalizeEventId(
    findPayloadValue(clientPayload, [
      "clientDatabaseId",
      "clientDbid",
      "clientDatabaseID",
      "client_database_id",
    ]),
  )

  return {
    ...clientPayload,
    clid,
    cid,
    clientNickname:
      typeof nickname === "string" && nickname
        ? nickname
        : "Client " + String(clid),
    clientDatabaseId,
  }
}

function createNestedList(
  list: TreeItem[],
  itemId: string | number = 0,
): TreeItem[] {
  return list
    .filter((item) => String(item.parentItemId) === String(itemId))
    .map((item) => {
      if (item.itemId === null) {
        return item
      }

      const children = createNestedList(list, item.itemId)

      return children.length ? { ...item, children } : item
    })
}

function mergeTreeItems(
  clients: ClientRow[],
  channels: ChannelRow[],
): TreeItem[] {
  return [
    ...clients.map((client) => ({
      ...client,
      id: String(client.clid) + "-client",
      itemId: null,
      parentItemId: client.cid,
    })),
    ...channels.map((channel) => ({
      ...channel,
      id: String(channel.cid) + "-channel",
      itemId: channel.cid,
      parentItemId: channel.pid,
    })),
  ]
}

function isClientTreeItem(item: TreeItem): item is ClientTreeItem {
  return item.itemId === null
}

function formatChannelName(channelName: string): SpacerDisplay {
  const match = channelName.match(
    /^\[(\*)?(cspacer|rspacer|lspacer|spacer)\d*\]\s*(.*)$/i,
  )

  if (!match) {
    return {
      isSpacer: false,
      label: channelName,
      alignment: "left",
    }
  }

  const hasStar = match[1] === "*"
  const spacerType = match[2].toLowerCase()
  const label = match[3].trim() || " "

  return {
    isSpacer: true,
    label,
    alignment:
      spacerType === "cspacer"
        ? hasStar
          ? "left"
          : "center"
        : spacerType === "rspacer"
          ? "right"
          : "left",
  }
}

function getTreeMenuPosition(
  rowRect: DOMRect,
  containerRect: DOMRect,
  menuWidth: number,
  menuHeight: number,
): TreeMenuPosition {
  const viewportHeight = window.innerHeight
  const maxLeft = Math.max(0, containerRect.width - menuWidth)
  const preferredLeft = rowRect.left - containerRect.left
  const preferredTop = rowRect.bottom - containerRect.top + 4
  const fallbackTop = rowRect.top - containerRect.top - menuHeight - 4
  const opensDown =
    rowRect.bottom + 4 + menuHeight <= viewportHeight - TREE_MENU_EDGE_GAP

  return {
    left: Math.min(Math.max(0, preferredLeft), maxLeft),
    top: Math.max(0, opensDown ? preferredTop : fallbackTop),
  }
}

function getTreeMenuItemId(activeTreeMenu: ActiveTreeMenu) {
  return activeTreeMenu?.item.id ?? null
}

function getTreeMenuSize(type: Exclude<ActiveTreeMenu, null>["type"]) {
  return type === "channel"
    ? {
        height: CHANNEL_TREE_MENU_HEIGHT,
        width: CHANNEL_TREE_MENU_WIDTH,
      }
    : {
        height: CLIENT_TREE_MENU_HEIGHT,
        width: CLIENT_TREE_MENU_WIDTH,
      }
}

function TreeMenuItemButton({
  children,
  destructive,
  disabled,
  onClick,
}: {
  children: ReactNode
  destructive?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
        destructive && "text-destructive focus-visible:text-destructive",
      )}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function TreeMenuItemLink({
  children,
  destructive,
  onClick,
  to,
}: {
  children: ReactNode
  destructive?: boolean
  onClick?: () => void
  to: string
}) {
  return (
    <Link
      className={cn(
        "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
        destructive && "text-destructive focus-visible:text-destructive",
      )}
      to={to}
      onClick={onClick}
    >
      {children}
    </Link>
  )
}

function TreeContextMenu({
  activeTreeMenu,
  onClientAction,
  onClose,
  onDeleteChannel,
  onSwitchChannel,
}: {
  activeTreeMenu: ActiveTreeMenu
  onClientAction: (type: ClientActionType, client: ClientTreeItem) => void
  onClose: () => void
  onDeleteChannel: (channel: ChannelTreeItem) => void
  onSwitchChannel: (channel: ChannelTreeItem) => void
}) {
  if (!activeTreeMenu) {
    return null
  }

  const className =
    activeTreeMenu.type === "channel" ? "w-52" : "w-64"

  return (
    <div
      data-tree-context-menu
      className={cn(
        "absolute z-50 overflow-hidden rounded-md border bg-popover py-1 text-popover-foreground shadow-lg",
        className,
      )}
      style={{
        left: activeTreeMenu.position.left,
        top: activeTreeMenu.position.top,
      }}
    >
      {activeTreeMenu.type === "channel" ? (
        <>
          <TreeMenuItemButton
            onClick={() => {
              onClose()
              onSwitchChannel(activeTreeMenu.item)
            }}
          >
            <ArrowRight className="size-4" />
            Switch to Channel
          </TreeMenuItemButton>
          <TreeMenuItemLink
            to={"/chat/" + String(activeTreeMenu.item.cid)}
            onClick={onClose}
          >
            <MessageSquare className="size-4" />
            Open Text Chat
          </TreeMenuItemLink>
          <TreeMenuItemLink
            to={
              "/channel/" +
              String(activeTreeMenu.item.cid) +
              "/edit?pid=" +
              String(activeTreeMenu.item.pid)
            }
            onClick={onClose}
          >
            <Edit className="size-4" />
            Edit Channel
          </TreeMenuItemLink>
          <TreeMenuItemLink
            to={"/permissions/channel/" + String(activeTreeMenu.item.cid)}
            onClick={onClose}
          >
            <LockKeyhole className="size-4" />
            Channel Permissions
          </TreeMenuItemLink>
          <TreeMenuItemLink
            to={"/channel/add?pid=" + String(activeTreeMenu.item.cid)}
            onClick={onClose}
          >
            <Plus className="size-4" />
            Create Sub-Channel
          </TreeMenuItemLink>
          <TreeMenuItemButton
            destructive
            onClick={() => {
              onClose()
              onDeleteChannel(activeTreeMenu.item)
            }}
          >
            <Trash2 className="size-4" />
            Delete Channel
          </TreeMenuItemButton>
        </>
      ) : (
        <>
          <TreeMenuItemButton
            onClick={() => {
              onClose()
              onClientAction("poke", activeTreeMenu.item)
            }}
          >
            <Zap className="size-4" />
            Poke Client
          </TreeMenuItemButton>
          <TreeMenuItemLink
            to={"/chat?client=" + String(activeTreeMenu.item.clid)}
            onClick={onClose}
          >
            <MessageSquare className="size-4" />
            Open Text Chat
          </TreeMenuItemLink>
          <TreeMenuItemLink
            to={"/client/" + String(activeTreeMenu.item.clid) + "/edit"}
            onClick={onClose}
          >
            <Edit className="size-4" />
            Edit Client
          </TreeMenuItemLink>
          <TreeMenuItemButton
            onClick={() => {
              onClose()
              onClientAction("kick-channel", activeTreeMenu.item)
            }}
          >
            <ArrowRight className="size-4" />
            Kick Client from Channel
          </TreeMenuItemButton>
          <TreeMenuItemButton
            onClick={() => {
              onClose()
              onClientAction("kick-server", activeTreeMenu.item)
            }}
          >
            <ArrowRight className="size-4" />
            Kick Client from Server
          </TreeMenuItemButton>
          {activeTreeMenu.item.clientDatabaseId !== undefined &&
          activeTreeMenu.item.clientDatabaseId !== null ? (
            <TreeMenuItemLink
              destructive
              to={"/client/" + String(activeTreeMenu.item.clientDatabaseId) + "/ban"}
              onClick={onClose}
            >
              <Ban className="size-4" />
              Ban Client
            </TreeMenuItemLink>
          ) : (
            <TreeMenuItemButton disabled>
              <Ban className="size-4" />
              Ban Client
            </TreeMenuItemButton>
          )}
        </>
      )}
    </div>
  )
}

function ChannelTreeItem({
  activeMenuItemId,
  item,
  depth = 0,
  onClientAction,
  onDeleteChannel,
  onOpenTreeMenu,
  onSwitchChannel,
}: {
  activeMenuItemId: string | null
  item: TreeItem
  depth?: number
  onClientAction: (type: ClientActionType, client: ClientTreeItem) => void
  onDeleteChannel: (channel: ChannelTreeItem) => void
  onOpenTreeMenu: (item: TreeItem, rect: DOMRect) => void
  onSwitchChannel: (channel: ChannelTreeItem) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const suppressClickRef = useRef(false)
  const pointerOpenedMenuRef = useRef(false)
  const paddingLeft = String(depth * 30 + 8) + "px"
  const menuOpen = activeMenuItemId === item.id

  const openMenuForItem = (rect: DOMRect) => {
    onOpenTreeMenu(item, rect)
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return
    }

    if (event.pointerType !== "touch") {
      pointerOpenedMenuRef.current = true
      openMenuForItem(event.currentTarget.getBoundingClientRect())
      return
    }

    touchStartRef.current = {
      x: event.clientX,
      y: event.clientY,
    }
    suppressClickRef.current = false
    pointerOpenedMenuRef.current = false
  }

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "touch" || !touchStartRef.current) {
      return
    }

    const horizontalDelta = Math.abs(event.clientX - touchStartRef.current.x)
    const verticalDelta = Math.abs(event.clientY - touchStartRef.current.y)

    if (horizontalDelta > 8 || verticalDelta > 8) {
      suppressClickRef.current = true
    }
  }

  const handleClickCapture = (event: MouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) {
      event.preventDefault()
      event.stopPropagation()
      suppressClickRef.current = false
      pointerOpenedMenuRef.current = false
      return
    }

    event.preventDefault()
    event.stopPropagation()

    if (!pointerOpenedMenuRef.current) {
      openMenuForItem(event.currentTarget.getBoundingClientRect())
    }

    pointerOpenedMenuRef.current = false
  }

  if (isClientTreeItem(item)) {
    return (
      <button
        data-tree-menu-row
        data-tree-menu-row-id={item.id}
        className={cn(
          "flex min-w-0 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary/70 focus-visible:bg-secondary/70 focus-visible:outline-none",
          menuOpen && "bg-secondary/70",
        )}
        style={{ paddingLeft }}
        type="button"
        onClickCapture={handleClickCapture}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        <UserRound className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 items-center">
          <span className="min-w-0 truncate">{item.clientNickname}</span>
          <ClientStatusIcons client={item} className="ml-1 shrink-0" />
        </span>
      </button>
    )
  }

  const channelDisplay = formatChannelName(item.channelName)
  const children = item.children ?? []
  const hasClientChildren = children.some(isClientTreeItem)
  const visibleChildren = collapsed && hasClientChildren ? [] : children

  return (
    <div>
      <div
        data-tree-menu-row
        data-tree-menu-row-id={item.id}
        className={cn(
          "flex min-w-0 w-full items-center rounded-md transition-colors hover:bg-secondary/70 focus-within:bg-secondary/70",
          menuOpen && "bg-secondary/70",
        )}
        style={{ paddingLeft }}
      >
        {hasClientChildren ? (
          <button
            aria-label={collapsed ? "Expand channel" : "Collapse channel"}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setCollapsed((currentCollapsed) => !currentCollapsed)
            }}
          >
            {collapsed ? (
              <ChevronRight className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden="true" />
        )}

        <button
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm focus-visible:outline-none"
          type="button"
          onClickCapture={handleClickCapture}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
        >
          {channelDisplay.isSpacer ? (
            <span className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <Hash className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              channelDisplay.alignment === "center" && "text-center",
              channelDisplay.alignment === "right" && "text-right",
            )}
          >
            {channelDisplay.label}
          </span>
        </button>
      </div>

      {visibleChildren.map((child) => (
        <ChannelTreeItem
          activeMenuItemId={activeMenuItemId}
          depth={depth + 1}
          item={child}
          key={child.id}
          onClientAction={onClientAction}
          onDeleteChannel={onDeleteChannel}
          onOpenTreeMenu={onOpenTreeMenu}
          onSwitchChannel={onSwitchChannel}
        />
      ))}
    </div>
  )
}

export function ServerViewerPage() {
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const selectedServerId = useMemo(() => {
    if (isUsableServerId(queryUser.virtualserverId)) {
      return queryUser.virtualserverId
    }

    if (isUsableServerId(serverId)) {
      return serverId
    }

    return undefined
  }, [queryUser.virtualserverId, serverId])

  const reloadTimerRef = useRef<number | null>(null)
  const reloadInFlightRef = useRef(false)
  const reloadQueuedRef = useRef(false)
  const queryUserRef = useRef(queryUser)
  const treeWrapperRef = useRef<HTMLDivElement | null>(null)
  const { dismissToast, showError, toasts } = useToastStack()
  const selectedServerKey = isUsableServerId(selectedServerId)
    ? String(selectedServerId)
    : undefined
  const initialCache = getServerViewerCache(selectedServerKey)
  const [serverInfo, setServerInfo] = useState<ServerInfo>(
    () => initialCache?.serverInfo ?? {},
  )
  const [channelList, setChannelList] = useState<ChannelRow[]>(
    () => initialCache?.channelList ?? [],
  )
  const [clientList, setClientList] = useState<ClientRow[]>(
    () => initialCache?.clientList ?? [],
  )
  const [loading, setLoading] = useState(() => !initialCache?.loaded)
  const [clientAction, setClientAction] = useState<ClientAction>(null)
  const [clientActionMessage, setClientActionMessage] = useState("")
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [deleteChannelAction, setDeleteChannelAction] =
    useState<DeleteChannelAction>(null)
  const [forceChannelDelete, setForceChannelDelete] = useState(false)
  const [activeTreeMenu, setActiveTreeMenu] = useState<ActiveTreeMenu>(null)

  const hasMatchingCache = Boolean(
    selectedServerKey &&
    serverViewerCache.loaded &&
    serverViewerCache.serverId === selectedServerKey,
  )

  const channelTree = useMemo(
    () => createNestedList(mergeTreeItems(clientList, channelList)),
    [channelList, clientList],
  )
  const activeTreeMenuId = getTreeMenuItemId(activeTreeMenu)

  useEffect(() => {
    queryUserRef.current = queryUser
  }, [queryUser])

  const closeTreeMenu = useCallback(() => {
    setActiveTreeMenu(null)
  }, [])

  const openTreeMenu = useCallback((item: TreeItem, rect: DOMRect) => {
    const containerRect = treeWrapperRef.current?.getBoundingClientRect()

    if (!containerRect) {
      return
    }

    if (isClientTreeItem(item)) {
      const { height, width } = getTreeMenuSize("client")

      setActiveTreeMenu({
        item,
        position: getTreeMenuPosition(rect, containerRect, width, height),
        type: "client",
      })
      return
    }

    const { height, width } = getTreeMenuSize("channel")

    setActiveTreeMenu({
      item,
      position: getTreeMenuPosition(rect, containerRect, width, height),
      type: "channel",
    })
  }, [])

  useEffect(() => {
    if (!activeTreeMenu) {
      return
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target

      if (!(target instanceof Element)) {
        closeTreeMenu()
        return
      }

      if (target.closest("[data-tree-context-menu]")) {
        return
      }

      if (target.closest("[data-tree-menu-row]")) {
        return
      }

      closeTreeMenu()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTreeMenu()
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [activeTreeMenu, closeTreeMenu])

  const setError = useCallback(
    (message: string | null) => {
      showError(message)
    },
    [showError],
  )

  const ensureSelectedServer = useCallback(
    async (progress: "foreground" | "background" | "none" = "foreground") => {
      if (!isUsableServerId(selectedServerId)) {
        throw new Error("No valid virtual server selected.")
      }

      const validSelectedServerId = selectedServerId as string | number

      const currentQueryUser = queryUserRef.current

      if (
        isUsableServerId(currentQueryUser.virtualserverId) &&
        String(currentQueryUser.virtualserverId) ===
          String(validSelectedServerId)
      ) {
        saveServerId(validSelectedServerId)
        return currentQueryUser
      }

      await TeamSpeak.useServer(validSelectedServerId, {
        progress,
      })

      saveServerId(validSelectedServerId)

      return undefined
    },
    [saveServerId, selectedServerId],
  )

  const loadChannelTree = useCallback(
    async (
      options: {
        ensureSelection?: boolean
        queryUser?: QueryUser
        progress?: "foreground" | "background" | "none"
      } = {},
    ) => {
      if (!selectedServerKey) {
        throw new Error("No valid virtual server selected.")
      }

      const existingFlight = channelTreeLoadFlights.get(selectedServerKey)

      if (existingFlight) {
        const result = await existingFlight

        setChannelList(result.channelList)
        setClientList(result.clientList)

        if (result.queryUser) {
          saveQueryUser(result.queryUser)
        }

        return result.queryUser ?? {}
      }

      const flight = (async () => {
        let selectedQueryUser = options.queryUser

        if (options.ensureSelection !== false) {
          selectedQueryUser = await ensureSelectedServer(
            options.progress ?? "background",
          )
        }

        const [nextChannels, nextClients, nextQueryUser] = await Promise.all([
          TeamSpeak.execute<ChannelRow[]>("channellist", {}, [], {
            progress: options.progress ?? "background",
          }),
          TeamSpeak.execute<ClientRow[]>(
            "clientlist",
            {},
            ["-voice", "-away"],
            {
              progress: options.progress ?? "background",
            },
          ),
          selectedQueryUser ??
            TeamSpeak.ensureQueryIdentity({
              progress: options.progress ?? "background",
            }),
        ])

        serverViewerCache.serverId = selectedServerKey
        serverViewerCache.channelList = nextChannels
        serverViewerCache.clientList = nextClients
        serverViewerCache.queryUser = nextQueryUser
        serverViewerCache.loaded = true
        serverViewerCache.lastLoadedAt = Date.now()
        writeServerViewerCache(serverViewerCache)

        return {
          serverInfo: serverViewerCache.serverInfo,
          channelList: nextChannels,
          clientList: nextClients,
          queryUser: nextQueryUser,
        }
      })().finally(() => {
        channelTreeLoadFlights.delete(selectedServerKey)
      })

      channelTreeLoadFlights.set(selectedServerKey, flight)

      const result = await flight

      setChannelList(result.channelList)
      setClientList(result.clientList)

      if (result.queryUser) {
        saveQueryUser(result.queryUser)
      }

      return result.queryUser ?? {}
    },
    [ensureSelectedServer, saveQueryUser, selectedServerKey],
  )

  const scheduleChannelTreeReload = useCallback(() => {
    if (reloadTimerRef.current !== null) {
      window.clearTimeout(reloadTimerRef.current)
    }

    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null

      if (reloadInFlightRef.current) {
        reloadQueuedRef.current = true
        return
      }

      reloadInFlightRef.current = true
      void loadChannelTree()
        .catch((treeError: unknown) => {
          setError(getErrorMessage(treeError))
        })
        .finally(() => {
          reloadInFlightRef.current = false

          if (reloadQueuedRef.current) {
            reloadQueuedRef.current = false
            scheduleChannelTreeReload()
          }
        })
    }, 250)
  }, [loadChannelTree])

  const loadServerViewer = useCallback(
    async (options: { foreground?: boolean } = {}) => {
      if (!isUsableServerId(selectedServerId)) {
        setServerInfo({})
        setChannelList([])
        setClientList([])
        setError(null)
        setLoading(false)
        return
      }

      const currentCache = getServerViewerCache(selectedServerKey)
      const canUseCache = Boolean(currentCache?.loaded)

      if (currentCache?.loaded) {
        setServerInfo(currentCache.serverInfo)
        setChannelList(currentCache.channelList)
        setClientList(currentCache.clientList)

        if (currentCache.queryUser) {
          saveQueryUser(currentCache.queryUser)
        }
      } else {
        setServerInfo({})
        setChannelList([])
        setClientList([])
      }

      setLoading(Boolean(options.foreground) || !canUseCache)
      setError(null)

      try {
        if (!selectedServerKey) {
          throw new Error("No valid virtual server selected.")
        }

        let flight = serverViewerLoadFlights.get(selectedServerKey)
        const hadExistingFlight = Boolean(flight)

        if (!flight) {
          flight = (async () => {
            const progress: ProgressMode =
              options.foreground || !canUseCache ? "foreground" : "background"
            const selectedQueryUser = await ensureSelectedServer(progress)

            const [info, nextChannels, nextClients, nextQueryUser] =
              await Promise.all([
                TeamSpeak.execute<ServerInfo[]>("serverinfo", {}, [], {
                  progress,
                }),
                TeamSpeak.execute<ChannelRow[]>("channellist", {}, [], {
                  progress,
                }),
                TeamSpeak.execute<ClientRow[]>(
                  "clientlist",
                  {},
                  ["-voice", "-away"],
                  {
                    progress,
                  },
                ),
                selectedQueryUser ??
                  TeamSpeak.ensureQueryIdentity({ progress: "background" }),
              ])

            const nextServerInfo = info[0] ?? {}

            serverViewerCache.serverId = selectedServerKey
            serverViewerCache.serverInfo = nextServerInfo
            serverViewerCache.channelList = nextChannels
            serverViewerCache.clientList = nextClients
            serverViewerCache.queryUser = nextQueryUser
            serverViewerCache.loaded = true
            serverViewerCache.lastLoadedAt = Date.now()
            writeServerViewerCache(serverViewerCache)

            return {
              serverInfo: nextServerInfo,
              channelList: nextChannels,
              clientList: nextClients,
              queryUser: nextQueryUser,
            }
          })().finally(() => {
            serverViewerLoadFlights.delete(selectedServerKey)
          })

          serverViewerLoadFlights.set(selectedServerKey, flight)
        }

        let wrappedExistingForeground = false

        if (options.foreground && hadExistingFlight) {
          startLoading()
          wrappedExistingForeground = true
        }

        const result = await flight.finally(() => {
          if (wrappedExistingForeground) {
            stopLoading()
          }
        })

        setServerInfo(result.serverInfo)
        setChannelList(result.channelList)
        setClientList(result.clientList)

        if (result.queryUser) {
          saveQueryUser(result.queryUser)
        }
      } catch (loadError) {
        setError(getErrorMessage(loadError))
      } finally {
        setLoading(false)
      }
    },
    [ensureSelectedServer, saveQueryUser, selectedServerId, selectedServerKey],
  )

  const moveClientLocally = useCallback(
    (clientId: string | number, channelId: string | number) => {
      setClientList((currentClients) => {
        const nextClients = currentClients.map((client) =>
          String(client.clid) === String(clientId)
            ? { ...client, cid: channelId }
            : client,
        )

        if (
          selectedServerKey &&
          serverViewerCache.serverId === selectedServerKey
        ) {
          serverViewerCache.clientList = nextClients
          writeServerViewerCache(serverViewerCache)
        }

        return nextClients
      })

      if (String(queryUser.clientId ?? "") === String(clientId)) {
        saveQueryUser({
          ...queryUser,
          clientChannelId: channelId,
        })
      }
    },
    [queryUser, saveQueryUser, selectedServerKey],
  )

  const removeClientLocally = useCallback(
    (clientId: string | number) => {
      setClientList((currentClients) => {
        const nextClients = currentClients.filter(
          (client) => String(client.clid) !== String(clientId),
        )

        if (
          selectedServerKey &&
          serverViewerCache.serverId === selectedServerKey
        ) {
          serverViewerCache.clientList = nextClients
          writeServerViewerCache(serverViewerCache)
        }

        return nextClients
      })
    },
    [selectedServerKey],
  )

  const removeChannelLocally = useCallback(
    (channelId: string | number) => {
      setChannelList((currentChannels) => {
        const nextChannels = currentChannels.filter(
          (channel) => String(channel.cid) !== String(channelId),
        )

        if (
          selectedServerKey &&
          serverViewerCache.serverId === selectedServerKey
        ) {
          serverViewerCache.channelList = nextChannels
          writeServerViewerCache(serverViewerCache)
        }

        return nextChannels
      })

      setClientList((currentClients) => {
        const nextClients = currentClients.filter(
          (client) => String(client.cid) !== String(channelId),
        )

        if (
          selectedServerKey &&
          serverViewerCache.serverId === selectedServerKey
        ) {
          serverViewerCache.clientList = nextClients
          writeServerViewerCache(serverViewerCache)
        }

        return nextClients
      })
    },
    [selectedServerKey],
  )

  const openClientAction = (type: ClientActionType, client: ClientTreeItem) => {
    setClientAction({ type, client })
    setClientActionMessage("")
    setDialogError(null)
    setError(null)
  }

  const closeClientAction = () => {
    if (actionBusy) {
      return
    }

    setClientAction(null)
    setDialogError(null)
  }

  const submitClientAction = async () => {
    if (!clientAction) {
      return
    }

    setActionBusy(true)
    setDialogError(null)
    setError(null)

    try {
      await ensureSelectedServer()

      if (clientAction.type === "poke") {
        await TeamSpeak.execute("clientpoke", {
          clid: clientAction.client.clid,
          msg: clientActionMessage,
        })
      }

      if (clientAction.type === "kick-channel") {
        await TeamSpeak.execute("clientkick", {
          clid: clientAction.client.clid,
          reasonid: 4,
          reasonmsg: clientActionMessage,
        })
        scheduleChannelTreeReload()
      }

      if (clientAction.type === "kick-server") {
        await TeamSpeak.execute("clientkick", {
          clid: clientAction.client.clid,
          reasonid: 5,
          reasonmsg: clientActionMessage,
        })
        removeClientLocally(clientAction.client.clid)
        scheduleChannelTreeReload()
      }

      setClientAction(null)
    } catch (actionError) {
      setClientAction(null)
      setError(getErrorMessage(actionError))
    } finally {
      setActionBusy(false)
    }
  }

  const handleSwitchChannel = async (channel: ChannelTreeItem) => {
    setError(null)

    const currentClientId = normalizeEventId(queryUser.clientId)

    if (currentClientId) {
      moveClientLocally(currentClientId, channel.cid)
    }

    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("clientmove", {
        clid: queryUser.clientId,
        cid: channel.cid,
      })
      scheduleChannelTreeReload()
    } catch (switchError) {
      setError(getErrorMessage(switchError))
      scheduleChannelTreeReload()
    }
  }

  const openDeleteChannel = (channel: ChannelTreeItem) => {
    setDeleteChannelAction({ channel })
    setForceChannelDelete(false)
    setDialogError(null)
    setError(null)
  }

  const closeDeleteChannel = () => {
    if (actionBusy) {
      return
    }

    setDeleteChannelAction(null)
    setDialogError(null)
  }

  const confirmDeleteChannel = async () => {
    if (!deleteChannelAction) {
      return
    }

    setActionBusy(true)
    setDialogError(null)

    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("channeldelete", {
        cid: deleteChannelAction.channel.cid,
        force: forceChannelDelete ? 1 : 0,
      })
      removeChannelLocally(deleteChannelAction.channel.cid)
      scheduleChannelTreeReload()
      setDeleteChannelAction(null)
    } catch (deleteError) {
      setDialogError(getErrorMessage(deleteError))
    } finally {
      setActionBusy(false)
    }
  }

  useEffect(() => {
    void loadServerViewer()
  }, [loadServerViewer])

  useEffect(() => {
    if (!isUsableServerId(selectedServerId)) {
      return
    }

    const addClientLocally = (client: ClientRow) => {
      setClientList((currentClients) => {
        const withoutDuplicate = currentClients.filter(
          (currentClient) => String(currentClient.clid) !== String(client.clid),
        )
        const nextClients = [...withoutDuplicate, client]

        if (
          selectedServerKey &&
          serverViewerCache.serverId === selectedServerKey
        ) {
          serverViewerCache.clientList = nextClients
          writeServerViewerCache(serverViewerCache)
        }

        return nextClients
      })
    }

    const removeClientLocally = (clientId: string | number) => {
      setClientList((currentClients) => {
        const nextClients = currentClients.filter(
          (client) => String(client.clid) !== String(clientId),
        )

        if (
          selectedServerKey &&
          serverViewerCache.serverId === selectedServerKey
        ) {
          serverViewerCache.clientList = nextClients
          writeServerViewerCache(serverViewerCache)
        }

        return nextClients
      })
    }

    const handleClientMoved: EventListener = (event) => {
      const payload = getEventDetail(event)
      const movedClientId = getMovedClientId(payload)
      const targetChannelId = getTargetChannelId(payload)

      if (movedClientId !== undefined && targetChannelId !== undefined) {
        moveClientLocally(movedClientId, targetChannelId)
      }

      scheduleChannelTreeReload()
    }

    const handleClientConnect: EventListener = (event) => {
      const connectedClient = getConnectedClient(getEventDetail(event))

      if (connectedClient) {
        addClientLocally(connectedClient)
      }

      scheduleChannelTreeReload()
    }

    const handleClientDisconnect: EventListener = (event) => {
      const disconnectedClientId = getMovedClientId(getEventDetail(event))

      if (disconnectedClientId !== undefined) {
        removeClientLocally(disconnectedClientId)
      }

      scheduleChannelTreeReload()
    }

    const handleTreeEvent: EventListener = () => {
      scheduleChannelTreeReload()
    }

    TeamSpeak.on("clientmoved", handleClientMoved)
    TeamSpeak.on("clientconnect", handleClientConnect)
    TeamSpeak.on("clientdisconnect", handleClientDisconnect)
    TeamSpeak.on("channelcreate", handleTreeEvent)
    TeamSpeak.on("channeledit", handleTreeEvent)
    TeamSpeak.on("channelmoved", handleTreeEvent)
    TeamSpeak.on("channeldelete", handleTreeEvent)

    return () => {
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current)
        reloadTimerRef.current = null
      }

      TeamSpeak.off("clientmoved", handleClientMoved)
      TeamSpeak.off("clientconnect", handleClientConnect)
      TeamSpeak.off("clientdisconnect", handleClientDisconnect)
      TeamSpeak.off("channelcreate", handleTreeEvent)
      TeamSpeak.off("channeledit", handleTreeEvent)
      TeamSpeak.off("channelmoved", handleTreeEvent)
      TeamSpeak.off("channeldelete", handleTreeEvent)
    }
  }, [
    moveClientLocally,
    scheduleChannelTreeReload,
    selectedServerId,
    selectedServerKey,
  ])

  const clientActionTitle =
    clientAction?.type === "poke"
      ? "Poke"
      : clientAction?.type === "kick-channel"
        ? "Kick from Channel"
        : "Kick from Server"
  const clientActionMessageLabel =
    clientAction?.type === "poke" ? "Poke Message" : "Kick Message"
  const clientActionSubmitLabel = clientAction?.type === "poke" ? "Send" : "OK"

  if (!isUsableServerId(selectedServerId)) {
    return (
      <div className="mx-auto flex min-h-[55vh] w-full max-w-xl items-center justify-center">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>No server selected</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select an online virtual server from Server List first.
            </p>
            <Button asChild>
              <Link to="/servers">Go to Server List</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Card>
        <CardHeader className="flex flex-col items-stretch gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 sm:flex-1">
            <CardTitle className="truncate">
              {valueOrDash(serverInfo.virtualserverName)}
            </CardTitle>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:flex-nowrap">
            <Button asChild className="min-w-32 flex-1 sm:flex-none" size="sm">
              <Link to="/channel/add">
                <Plus className="size-4" />
                Add Channel
              </Link>
            </Button>
            <Button
              asChild
              className="min-w-32 flex-1 sm:flex-none"
              size="sm"
              variant="outline"
            >
              <Link to="/spacer/add">
                <Plus className="size-4" />
                Add Spacer
              </Link>
            </Button>
            <Button
              className="min-w-28 flex-1 sm:flex-none"
              disabled={loading}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void loadServerViewer({ foreground: true })}
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && !hasMatchingCache && channelTree.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Loading server viewer...
            </div>
          ) : channelTree.length ? (
            <div
              ref={treeWrapperRef}
              className="relative max-w-full overflow-visible rounded-lg border p-2"
            >
              <div className="max-w-full space-y-0.5 overflow-x-hidden">
                {channelTree.map((item) => (
                  <ChannelTreeItem
                    activeMenuItemId={activeTreeMenuId}
                    item={item}
                    key={item.id}
                    onClientAction={openClientAction}
                    onDeleteChannel={openDeleteChannel}
                    onOpenTreeMenu={openTreeMenu}
                    onSwitchChannel={(channel) =>
                      void handleSwitchChannel(channel)
                    }
                  />
                ))}
              </div>
              <TreeContextMenu
                activeTreeMenu={activeTreeMenu}
                onClientAction={openClientAction}
                onClose={closeTreeMenu}
                onDeleteChannel={openDeleteChannel}
                onSwitchChannel={(channel) => void handleSwitchChannel(channel)}
              />
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              No channels or clients found.
            </div>
          )}
        </CardContent>
      </Card>

      <AppModal
        open={Boolean(clientAction)}
        preventClose={actionBusy}
        title={clientActionTitle}
        footer={
          <>
            <Button
              disabled={actionBusy}
              type="button"
              variant="outline"
              onClick={closeClientAction}
            >
              Cancel
            </Button>
            <Button
              disabled={actionBusy}
              type="button"
              onClick={() => void submitClientAction()}
            >
              {actionBusy ? "Working..." : clientActionSubmitLabel}
            </Button>
          </>
        }
        onClose={closeClientAction}
      >
        <div className="space-y-2">
          <Label htmlFor="client-action-message">
            {clientActionMessageLabel}
          </Label>
          <Input
            disabled={actionBusy}
            id="client-action-message"
            value={clientActionMessage}
            onChange={(event) => setClientActionMessage(event.target.value)}
          />
        </div>
      </AppModal>

      <AppModal
        open={Boolean(deleteChannelAction)}
        preventClose={actionBusy}
        title="Delete Channel"
        footer={
          <>
            <Button
              disabled={actionBusy}
              type="button"
              variant="outline"
              onClick={closeDeleteChannel}
            >
              Cancel
            </Button>
            <Button
              disabled={actionBusy}
              type="button"
              variant="destructive"
              onClick={() => void confirmDeleteChannel()}
            >
              {actionBusy ? "Working..." : "Delete"}
            </Button>
          </>
        }
        onClose={closeDeleteChannel}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Do you really want to delete this channel?
          </p>
          {deleteChannelAction ? (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
              {getChannelLabel(deleteChannelAction.channel)}
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={forceChannelDelete}
              disabled={actionBusy}
              onCheckedChange={(checked) =>
                setForceChannelDelete(checked === true)
              }
            />
            Delete even if there are clients in the channel
          </label>
          {dialogError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {dialogError}
            </div>
          ) : null}
        </div>
      </AppModal>
    </div>
  )
}
