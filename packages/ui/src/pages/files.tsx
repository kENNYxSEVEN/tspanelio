import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import {
  ChevronRight,
  Download,
  File,
  Folder,
  FolderOpen,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth } from "@/auth/auth-context"
import { AppModal } from "@/components/app-modal"
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
import { cn } from "@/lib/utils"

type ChannelRow = {
  cid: string | number
  channelName: string
  [key: string]: unknown
}

type RawFileRow = {
  cid?: string | number
  datetime?: string | number
  name: string
  path?: string
  size?: string | number
  type: string | number
  [key: string]: unknown
}

type FileRow = {
  cid: string | number
  datetime?: string | number
  id: string
  name: string
  path: string
  size?: string | number
  type: 0 | 1
}

type FileTransferDownload = {
  ftkey: string
  port: string | number
  size: string | number
}

type TreeParent =
  | { channel: ChannelRow; kind: "channel" }
  | { item: FileRow; kind: "folder" }

type FileAction =
  | { item: FileRow; type: "delete" }
  | { item: FileRow; type: "rename" }
  | { parent: TreeParent; type: "create" }
  | { items: FileRow[]; type: "delete-selected" }
  | null

const filesChannelsFlights = new Map<string, Promise<ChannelRow[]>>()
const fileListFlights = new Map<string, Promise<FileRow[]>>()

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

function normalizePath(value: string | null | undefined) {
  if (!value || value.trim() === "") {
    return "/"
  }

  const normalized = value.replace(/\\/g, "/").replace(/\/+/g, "/")

  if (normalized === "/") {
    return "/"
  }

  const withoutTrailingSlash = normalized.replace(/\/$/g, "")

  return withoutTrailingSlash.startsWith("/")
    ? withoutTrailingSlash
    : "/" + withoutTrailingSlash
}

function trimPathSegment(value: string) {
  return value.replace(/^\/+|\/+$/g, "")
}

function joinFilePath(basePath: string | undefined, name: string) {
  const normalizedBase = normalizePath(basePath)
  const normalizedName = trimPathSegment(name)

  if (!normalizedName) {
    return normalizedBase
  }

  return normalizedBase === "/"
    ? "/" + normalizedName
    : normalizedBase + "/" + normalizedName
}

function isFolder(item: FileRow) {
  return item.type === 0
}

function getParentPath(parent: TreeParent) {
  return parent.kind === "channel"
    ? "/"
    : joinFilePath(parent.item.path, parent.item.name)
}

function getParentCid(parent: TreeParent) {
  return parent.kind === "channel" ? parent.channel.cid : parent.item.cid
}

function getParentKey(parent: TreeParent) {
  return getCacheKey(getParentCid(parent), getParentPath(parent))
}

function getCacheKey(cid: string | number, path: string) {
  return String(cid) + ":" + normalizePath(path)
}

function getFileKey(item: FileRow) {
  return "file:" + getCacheKey(item.cid, joinFilePath(item.path, item.name))
}

function normalizeFileRows(files: RawFileRow[], fallbackCid: string | number) {
  return files.map((file) => {
    const type = Number(file.type) === 0 ? 0 : 1
    const path = normalizePath(file.path ?? "/")
    const datetime = file.datetime ?? ""

    return {
      cid: file.cid ?? fallbackCid,
      datetime,
      id: String(file.name) + "-" + String(datetime) + "-" + path,
      name: file.name,
      path,
      size: file.size,
      type,
    } satisfies FileRow
  })
}

function formatBytes(value: string | number | undefined, decimals = 2) {
  const bytes = Number(value ?? 0)

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 Bytes"
  }

  const units = ["Bytes", "KB", "MB", "GB", "TB"]
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )

  return (
    Number.parseFloat((bytes / Math.pow(1024, index)).toFixed(decimals)) +
    " " +
    units[index]
  )
}

function formatDate(value: string | number | undefined) {
  if (value === undefined || value === null || value === "") {
    return ""
  }

  const numericValue = Number(value)
  const date = Number.isFinite(numericValue)
    ? new Date(numericValue * 1000)
    : new Date(String(value))

  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString()
}

function getClientFileTransferId() {
  return Math.floor(Math.random() * 10000)
}

function getDownloadUrl({
  ftkey,
  name,
  port,
  size,
}: FileTransferDownload & { name: string }) {
  const base =
  import.meta.env.DEV && import.meta.env.VITE_WEBSOCKET_URI
    ? import.meta.env.VITE_WEBSOCKET_URI
    : window.location.origin
  const url = new URL("/api/download", base)

  url.searchParams.set("ftkey", ftkey)
  url.searchParams.set("port", String(port))
  url.searchParams.set("size", String(size))
  url.searchParams.set("name", name)

  return url.href
}

function isFileActionItem(action: FileAction): action is Extract<FileAction, { item: FileRow }> {
  return Boolean(action && "item" in action)
}

function isFileActionCreate(action: FileAction): action is Extract<FileAction, { type: "create" }> {
  return action?.type === "create"
}

function isFileActionDeleteSelected(
  action: FileAction,
): action is Extract<FileAction, { type: "delete-selected" }> {
  return action?.type === "delete-selected"
}

function getTreeIndentStyle(mobile: number, desktop: number) {
  return {
    "--file-tree-mobile-indent": `${mobile}px`,
    "--file-tree-desktop-indent": `${desktop}px`,
  } as CSSProperties
}

const TOUCH_SCROLL_THRESHOLD_PX = 8

type TouchSafeDropdownTriggerProps = {
  onClickCapture: (event: MouseEvent<HTMLButtonElement>) => void
  onPointerCancelCapture: () => void
  onPointerDownCapture: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerMoveCapture: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerUpCapture: (event: PointerEvent<HTMLButtonElement>) => void
}

type TouchSafeDropdownProps = {
  children: ReactNode
  trigger: (triggerProps: TouchSafeDropdownTriggerProps) => ReactElement
}

function TouchSafeDropdown({ children, trigger }: TouchSafeDropdownProps) {
  const [open, setOpen] = useState(false)
  const touchPointerRef = useRef<{ moved: boolean; x: number; y: number } | null>(
    null,
  )
  const blockNextClickRef = useRef(false)

  const handlePointerDownCapture = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== "touch") {
        return
      }

      touchPointerRef.current = {
        moved: false,
        x: event.clientX,
        y: event.clientY,
      }

      event.stopPropagation()
    },
    [],
  )

  const handlePointerMoveCapture = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const touchPointer = touchPointerRef.current

      if (event.pointerType !== "touch" || !touchPointer) {
        return
      }

      const distanceX = Math.abs(event.clientX - touchPointer.x)
      const distanceY = Math.abs(event.clientY - touchPointer.y)

      if (
        distanceX > TOUCH_SCROLL_THRESHOLD_PX ||
        distanceY > TOUCH_SCROLL_THRESHOLD_PX
      ) {
        touchPointer.moved = true
        blockNextClickRef.current = true
      }
    },
    [],
  )

  const handlePointerUpCapture = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const touchPointer = touchPointerRef.current

      if (event.pointerType !== "touch" || !touchPointer) {
        return
      }

      event.stopPropagation()

      const moved = touchPointer.moved

      touchPointerRef.current = null
      blockNextClickRef.current = true

      if (!moved) {
        setOpen((currentOpen) => !currentOpen)
      }
    },
    [],
  )

  const handlePointerCancelCapture = useCallback(() => {
    touchPointerRef.current = null
    blockNextClickRef.current = true
  }, [])

  const handleClickCapture = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (!blockNextClickRef.current) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      blockNextClickRef.current = false
    },
    [],
  )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {trigger({
          onClickCapture: handleClickCapture,
          onPointerCancelCapture: handlePointerCancelCapture,
          onPointerDownCapture: handlePointerDownCapture,
          onPointerMoveCapture: handlePointerMoveCapture,
          onPointerUpCapture: handlePointerUpCapture,
        })}
      </DropdownMenuTrigger>
      {children}
    </DropdownMenu>
  )
}

function FileTreeRow({
  actionBusy,
  childCache,
  depth,
  expandedKeys,
  item,
  loadingKeys,
  onCreateFolder,
  onDelete,
  onDownload,
  onRename,
  onToggle,
  onUpload,
  onToggleSelected,
  selected,
  selectedKeys,
}: {
  actionBusy: boolean
  childCache: Record<string, FileRow[]>
  depth: number
  expandedKeys: Set<string>
  item: FileRow
  loadingKeys: Set<string>
  onCreateFolder: (parent: TreeParent) => void
  onDelete: (item: FileRow) => void
  onDownload: (item: FileRow) => void
  onRename: (item: FileRow) => void
  onToggle: (parent: TreeParent) => void
  onUpload: (parent: TreeParent) => void
  onToggleSelected: (item: FileRow, checked: boolean) => void
  selected: boolean
  selectedKeys: Set<string>
}) {
  const folder = isFolder(item)
  const parent: TreeParent = { item, kind: "folder" }
  const parentKey = getParentKey(parent)
  const expanded = expandedKeys.has(parentKey)
  const loading = loadingKeys.has(parentKey)
  const children = childCache[parentKey] ?? []
  const desktopPaddingLeft = depth * 18 + 12
  const mobilePaddingLeft = Math.min(depth * 10 + 8, 56)
  const dateLabel = formatDate(item.datetime)

  return (
    <>
      <div
        className="grid min-h-12 grid-cols-[28px_28px_minmax(0,1fr)] items-center gap-1 border-b pl-[var(--file-tree-mobile-indent)] pr-2 text-sm last:border-b-0 hover:bg-muted/40 sm:min-h-10 sm:grid-cols-[32px_32px_minmax(0,1fr)] sm:pl-[var(--file-tree-desktop-indent)]"
        style={getTreeIndentStyle(mobilePaddingLeft, desktopPaddingLeft)}
      >
        {folder ? (
          <button
            aria-label={expanded ? "Collapse folder" : "Expand folder"}
            className="flex size-8 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-7"
            type="button"
            onClick={() => onToggle(parent)}
          >
            <ChevronRight
              className={cn("size-4 transition-transform", expanded && "rotate-90")}
            />
          </button>
        ) : (
          <span className="size-7" />
        )}

        <Checkbox
          checked={selected}
          disabled={actionBusy}
          onCheckedChange={(checked) => onToggleSelected(item, checked === true)}
        />

        <TouchSafeDropdown
          trigger={(triggerProps) => (
            <button
              aria-label={"Open actions for " + item.name}
              className="flex min-w-0 items-center gap-2 rounded-md py-2 text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 sm:py-1"
              disabled={actionBusy}
              type="button"
              {...triggerProps}
            >
              {folder ? (
                expanded ? (
                  <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                )
              ) : (
                <File className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 truncate font-medium">{item.name}</span>
              {!folder ? (
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {formatBytes(item.size)}
                </span>
              ) : null}
              {dateLabel ? (
                <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">
                  {dateLabel}
                </span>
              ) : null}
            </button>
          )}
        >
          <DropdownMenuContent
            align="start"
            className="w-56 max-w-[calc(100vw-2rem)] sm:w-64"
          >
            {folder ? (
              <>
                <DropdownMenuItem onSelect={() => onUpload(parent)}>
                  <Upload className="size-4" />
                  Upload File
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onCreateFolder(parent)}>
                  <Plus className="size-4" />
                  Create Subfolder
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onRename(item)}>
                  <Pencil className="size-4" />
                  Rename Folder
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onDelete(item)}>
                  <Trash2 className="size-4" />
                  Delete Folder
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem onSelect={() => onDownload(item)}>
                  <Download className="size-4" />
                  Download File
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onDelete(item)}>
                  <Trash2 className="size-4" />
                  Delete File
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onRename(item)}>
                  <Pencil className="size-4" />
                  Rename File
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </TouchSafeDropdown>
      </div>

      {folder && expanded ? (
        <TreeChildren
          actionBusy={actionBusy}
          childCache={childCache}
          childrenItems={children}
          depth={depth + 1}
          expandedKeys={expandedKeys}
          loading={loading}
          loadingKeys={loadingKeys}
          onCreateFolder={onCreateFolder}
          onDelete={onDelete}
          onDownload={onDownload}
          onRename={onRename}
          onToggle={onToggle}
          onToggleSelected={onToggleSelected}
          onUpload={onUpload}
          selectedKeys={selectedKeys}
        />
      ) : null}
    </>
  )
}

function TreeChildren({
  actionBusy,
  childCache,
  childrenItems,
  depth,
  expandedKeys,
  loading,
  loadingKeys,
  onCreateFolder,
  onDelete,
  onDownload,
  onRename,
  onToggle,
  onUpload,
  onToggleSelected,
  selectedKeys,
}: {
  actionBusy: boolean
  childCache: Record<string, FileRow[]>
  childrenItems: FileRow[]
  depth: number
  expandedKeys: Set<string>
  loading: boolean
  loadingKeys: Set<string>
  onCreateFolder: (parent: TreeParent) => void
  onDelete: (item: FileRow) => void
  onDownload: (item: FileRow) => void
  onRename: (item: FileRow) => void
  onToggle: (parent: TreeParent) => void
  onUpload: (parent: TreeParent) => void
  onToggleSelected: (item: FileRow, checked: boolean) => void
  selectedKeys?: Set<string>
}) {
  const desktopPaddingLeft = depth * 18 + 48
  const mobilePaddingLeft = Math.min(depth * 10 + 36, 80)

  if (loading) {
    return (
      <div
        className="border-b py-2 pl-[var(--file-tree-mobile-indent)] pr-2 text-sm text-muted-foreground sm:pl-[var(--file-tree-desktop-indent)]"
        style={getTreeIndentStyle(mobilePaddingLeft, desktopPaddingLeft)}
      >
        Loading files...
      </div>
    )
  }

  if (!childrenItems.length) {
    return (
      <div
        className="border-b py-2 pl-[var(--file-tree-mobile-indent)] pr-2 text-sm text-muted-foreground sm:pl-[var(--file-tree-desktop-indent)]"
        style={getTreeIndentStyle(mobilePaddingLeft, desktopPaddingLeft)}
      >
        This folder is empty.
      </div>
    )
  }

  return (
    <>
      {childrenItems.map((child) => (
        <FileTreeRow
          actionBusy={actionBusy}
          childCache={childCache}
          depth={depth}
          expandedKeys={expandedKeys}
          item={child}
          key={getFileKey(child)}
          loadingKeys={loadingKeys}
          selected={selectedKeys?.has(getFileKey(child)) ?? false}
          selectedKeys={selectedKeys ?? new Set<string>()}
          onCreateFolder={onCreateFolder}
          onDelete={onDelete}
          onDownload={onDownload}
          onRename={onRename}
          onToggle={onToggle}
          onToggleSelected={onToggleSelected}
          onUpload={onUpload}
        />
      ))}
    </>
  )
}

export function Files() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { queryUser, saveServerId, serverId } = useAuth()
  const { dismissToast, showError, showSuccess, toasts } = useToastStack()
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [channelsLoading, setChannelsLoading] = useState(true)
  const [childCache, setChildCache] = useState<Record<string, FileRow[]>>({})
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set())
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set())
  const [selectedFiles, setSelectedFiles] = useState<Record<string, FileRow>>({})
  const [actionBusy, setActionBusy] = useState(false)
  const [, setError] = useState<string | null>(null)
  const [fileAction, setFileAction] = useState<FileAction>(null)
  const [nameValue, setNameValue] = useState("")
  const deepLinkAppliedRef = useRef(false)

  const selectedServerId = useMemo(() => {
    if (isUsableServerId(queryUser.virtualserverId)) {
      return queryUser.virtualserverId
    }

    if (isUsableServerId(serverId)) {
      return serverId
    }

    return undefined
  }, [queryUser.virtualserverId, serverId])
  const selectedServerKey = isUsableServerId(selectedServerId)
    ? String(selectedServerId)
    : undefined
  const selectedFileList = useMemo(
    () => Object.values(selectedFiles),
    [selectedFiles],
  )

  const ensureSelectedServer = useCallback(
    async (progress: "foreground" | "background" | "none" = "background") => {
      if (!isUsableServerId(selectedServerId)) {
        throw new Error("No valid virtual server selected.")
      }

      const validSelectedServerId = selectedServerId as string | number

      await TeamSpeak.useServer(validSelectedServerId, { progress })
      saveServerId(validSelectedServerId)
    },
    [saveServerId, selectedServerId],
  )

  const loadChannels = useCallback(
    async (options: { foreground?: boolean } = {}) => {
      if (!selectedServerKey) {
        setChannels([])
        setChannelsLoading(false)
        return
      }

      setChannelsLoading(true)
      setError(null)

      try {
        await ensureSelectedServer(options.foreground ? "foreground" : "background")

        let flight = filesChannelsFlights.get(selectedServerKey)

        if (!flight || options.foreground) {
          flight = TeamSpeak.execute<ChannelRow[]>("channellist", {}, [], {
            progress: options.foreground ? "foreground" : "background",
          }).finally(() => {
            filesChannelsFlights.delete(selectedServerKey)
          })

          filesChannelsFlights.set(selectedServerKey, flight)
        }

        setChannels(await flight)
      } catch (loadError) {
        const message = getErrorMessage(loadError)

        setError(message)
        showError(message)
      } finally {
        setChannelsLoading(false)
      }
    },
    [ensureSelectedServer, selectedServerKey, showError],
  )

  const loadChildrenByPath = useCallback(
    async (
      cid: string | number,
      path: string,
      options: { force?: boolean; foreground?: boolean } = {},
    ) => {
      const key = getCacheKey(cid, path)

      if (!options.force && childCache[key]) {
        return childCache[key]
      }

      setLoadingKeys((current) => new Set(current).add(key))
      setError(null)

      try {
        await ensureSelectedServer(options.foreground ? "foreground" : "background")

        let flight = fileListFlights.get(key)

        if (!flight || options.force) {
          flight = TeamSpeak.execute<RawFileRow[]>(
            "ftgetfilelist",
            {
              cid,
              cpw: "",
              path,
            },
            [],
            { progress: options.foreground ? "foreground" : "background" },
          )
            .then((rows) => normalizeFileRows(rows, cid))
            .finally(() => {
              fileListFlights.delete(key)
            })

          fileListFlights.set(key, flight)
        }

        const children = await flight

        setChildCache((current) => ({ ...current, [key]: children }))
        setExpandedKeys((current) => new Set(current).add(key))

        return children
      } catch (loadError) {
        const message = getErrorMessage(loadError)

        setError(message)
        showError(message)

        return []
      } finally {
        setLoadingKeys((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
      }
    },
    [childCache, ensureSelectedServer, showError],
  )

  const loadChildren = useCallback(
    (parent: TreeParent, options: { force?: boolean; foreground?: boolean } = {}) =>
      loadChildrenByPath(getParentCid(parent), getParentPath(parent), options),
    [loadChildrenByPath],
  )

  useEffect(() => {
    void loadChannels()
  }, [loadChannels])

  useEffect(() => {
    if (deepLinkAppliedRef.current || !channels.length) {
      return
    }

    const cid = searchParams.get("cid")
    const path = normalizePath(searchParams.get("path"))

    if (!cid) {
      return
    }

    const channel = channels.find(
      (currentChannel) => String(currentChannel.cid) === String(cid),
    )

    if (!channel) {
      return
    }

    deepLinkAppliedRef.current = true

    const expandDeepLink = async () => {
      const channelParent: TreeParent = { channel, kind: "channel" }
      const channelKey = getParentKey(channelParent)

      setExpandedKeys((current) => new Set(current).add(channelKey))

      if (path === "/") {
        await loadChildren(channelParent)
        return
      }

      let currentParent: TreeParent = channelParent
      const segments = path.split("/").filter(Boolean)

      for (const segment of segments) {
        const currentChildren = await loadChildren(currentParent)
        const folder = currentChildren.find(
          (child) => isFolder(child) && child.name === segment,
        )

        if (!folder) {
          return
        }

        currentParent = { item: folder, kind: "folder" }
        setExpandedKeys((current) => new Set(current).add(getParentKey(currentParent)))
      }

      await loadChildren(currentParent)
    }

    void expandDeepLink()
  }, [channels, loadChildren, searchParams])

  const toggleParent = (parent: TreeParent) => {
    const key = getParentKey(parent)

    if (expandedKeys.has(key)) {
      setExpandedKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
      return
    }

    setExpandedKeys((current) => new Set(current).add(key))
    void loadChildren(parent)
  }

  const toggleSelected = (item: FileRow, checked: boolean) => {
    const key = getFileKey(item)

    setSelectedFiles((current) => {
      const next = { ...current }

      if (checked) {
        next[key] = item
      } else {
        delete next[key]
      }

      return next
    })
  }

  const openCreateFolder = (parent: TreeParent) => {
    setNameValue("")
    setFileAction({ parent, type: "create" })
  }

  const openUpload = (parent: TreeParent) => {
    const cid = getParentCid(parent)
    const path = getParentPath(parent)

    navigate(
      "/file/upload/" +
        encodeURIComponent(String(cid)) +
        (path === "/" ? "" : "?path=" + encodeURIComponent(path)),
    )
  }

  const openRename = (item: FileRow) => {
    setNameValue(item.name)
    setFileAction({ item, type: "rename" })
  }

  const closeAction = () => {
    if (actionBusy) {
      return
    }

    setFileAction(null)
    setNameValue("")
  }

  const refreshVisible = async () => {
    setChildCache({})
    setSelectedFiles({})
    setExpandedKeys(new Set())
    await loadChannels({ foreground: true })
  }

  const removeCachedSubtree = (cid: string | number, folderPath: string) => {
    const normalizedFolderPath = normalizePath(folderPath)
    const subtreePrefix = getCacheKey(cid, normalizedFolderPath)

    setChildCache((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => key !== subtreePrefix && !key.startsWith(subtreePrefix + "/"),
        ),
      ),
    )
    setExpandedKeys((current) => {
      const next = new Set(current)

      for (const key of next) {
        if (key === subtreePrefix || key.startsWith(subtreePrefix + "/")) {
          next.delete(key)
        }
      }

      return next
    })
    setSelectedFiles((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([, item]) => {
          const itemPath = joinFilePath(item.path, item.name)

          return (
            String(item.cid) !== String(cid) ||
            (itemPath !== normalizedFolderPath &&
              !itemPath.startsWith(normalizedFolderPath + "/"))
          )
        }),
      ),
    )
  }

  const reloadParentPath = async (cid: string | number, path: string) => {
    await loadChildrenByPath(cid, path, { force: true })
  }

  const createFolder = async () => {
    if (!isFileActionCreate(fileAction) || !nameValue.trim()) {
      return
    }

    const parent = fileAction.parent
    const cid = getParentCid(parent)
    const path = getParentPath(parent)

    setActionBusy(true)
    setError(null)

    try {
      await ensureSelectedServer("background")
      await TeamSpeak.execute(
        "ftcreatedir",
        {
          cid,
          cpw: "",
          dirname: joinFilePath(path, nameValue.trim()),
        },
        [],
        { progress: "foreground" },
      )
      showSuccess("Folder created")
      setFileAction(null)
      setNameValue("")
      await reloadParentPath(cid, path)
    } catch (createError) {
      const message = getErrorMessage(createError)

      setError(message)
      showError(message)
    } finally {
      setActionBusy(false)
    }
  }

  const renameItem = async (item: FileRow) => {
    if (!nameValue.trim() || nameValue === item.name) {
      return
    }

    setActionBusy(true)
    setError(null)

    try {
      await ensureSelectedServer("background")
      await TeamSpeak.execute(
        "ftrenamefile",
        {
          cid: item.cid,
          cpw: "",
          oldname: joinFilePath(item.path, item.name),
          newname: joinFilePath(item.path, nameValue.trim()),
        },
        [],
        { progress: "foreground" },
      )
      showSuccess(isFolder(item) ? "Folder renamed" : "File renamed")
      setFileAction(null)
      setNameValue("")
      setSelectedFiles((current) => {
        const next = { ...current }
        delete next[getFileKey(item)]
        return next
      })
      if (isFolder(item)) {
        removeCachedSubtree(item.cid, joinFilePath(item.path, item.name))
      }
      await reloadParentPath(item.cid, item.path)
    } catch (renameError) {
      const message = getErrorMessage(renameError)

      setError(message)
      showError(message)
    } finally {
      setActionBusy(false)
    }
  }

  const deleteFiles = async (items: FileRow[]) => {
    setActionBusy(true)
    setError(null)

    try {
      await ensureSelectedServer("background")

      for (const item of items) {
        await TeamSpeak.execute(
          "ftdeletefile",
          {
            cid: item.cid,
            cpw: "",
            name: joinFilePath(item.path, item.name),
          },
          [],
          { progress: "foreground" },
        )
      }

      showSuccess(items.length === 1 ? "Item deleted" : "Items deleted")
      setFileAction(null)
      setSelectedFiles((current) => {
        const next = { ...current }

        for (const item of items) {
          delete next[getFileKey(item)]
        }

        return next
      })

      for (const item of items) {
        if (isFolder(item)) {
          removeCachedSubtree(item.cid, joinFilePath(item.path, item.name))
        }
      }

      const parentKeys = new Set(items.map((item) => getCacheKey(item.cid, item.path)))

      for (const key of parentKeys) {
        const [cid, ...pathParts] = key.split(":")
        await reloadParentPath(cid, pathParts.join(":") || "/")
      }
    } catch (deleteError) {
      const message = getErrorMessage(deleteError)

      setError(message)
      showError(message)
    } finally {
      setActionBusy(false)
    }
  }

  const downloadFile = async (item: FileRow) => {
    if (isFolder(item)) {
      return
    }

    setActionBusy(true)
    setError(null)

    try {
      await ensureSelectedServer("background")
      const response = await TeamSpeak.execute<FileTransferDownload[]>(
        "ftinitdownload",
        {
          cid: item.cid,
          clientftfid: getClientFileTransferId(),
          cpw: "",
          name: joinFilePath(item.path, item.name),
          seekpos: 0,
        },
        [],
        { progress: "background" },
      )
      const transfer = response[0]

      if (!transfer) {
        throw new Error("Download could not be initialized.")
      }

      window.open(
        getDownloadUrl({
          ...transfer,
          name: item.name,
        }),
        "_blank",
        "noopener,noreferrer",
      )
    } catch (downloadError) {
      const message = getErrorMessage(downloadError)

      setError(message)
      showError(message)
    } finally {
      setActionBusy(false)
    }
  }

  const modalTitle =
    isFileActionCreate(fileAction)
      ? "Create Folder"
      : fileAction?.type === "rename" && isFileActionItem(fileAction)
        ? "Rename " + (isFolder(fileAction.item) ? "Folder" : "File")
        : fileAction?.type === "delete" && isFileActionItem(fileAction)
          ? "Delete " + (isFolder(fileAction.item) ? "Folder" : "File")
          : isFileActionDeleteSelected(fileAction)
            ? "Delete Selected Files/Folders"
            : undefined

  const actionLabel =
    isFileActionCreate(fileAction) || fileAction?.type === "rename"
      ? "OK"
      : "Yes"

  const actionDisabled =
    actionBusy ||
    (isFileActionCreate(fileAction) && !nameValue.trim()) ||
    (fileAction?.type === "rename" &&
      isFileActionItem(fileAction) &&
      (!nameValue.trim() || nameValue === fileAction.item.name))

  if (!isUsableServerId(selectedServerId)) {
    return (
      <div className="mx-auto flex min-h-[55vh] w-full max-w-xl items-center justify-center">
        <Card className="w-full">
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
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Card>
        <CardHeader className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Button
              className="flex-1 sm:flex-none"
              disabled={!selectedFileList.length || actionBusy}
              type="button"
              variant="destructive"
              onClick={() =>
                setFileAction({ items: selectedFileList, type: "delete-selected" })
              }
            >
              <Trash2 className="size-4" />
              Remove
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              disabled={channelsLoading || actionBusy}
              type="button"
              variant="outline"
              onClick={() => void refreshVisible()}
            >
              <RefreshCw
                className={cn("size-4", channelsLoading && "animate-spin")}
              />
              Refresh
            </Button>
          </div>
          {selectedFileList.length ? (
            <CardDescription className="min-w-0 truncate">
              {selectedFileList.length} selected
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-w-full overflow-x-hidden border-t">
            {channelsLoading ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                Loading channels...
              </div>
            ) : channels.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                No channels found.
              </div>
            ) : (
              channels.map((channel) => {
                const parent: TreeParent = { channel, kind: "channel" }
                const parentKey = getParentKey(parent)
                const expanded = expandedKeys.has(parentKey)
                const loading = loadingKeys.has(parentKey)
                const children = childCache[parentKey] ?? []

                return (
                  <div key={String(channel.cid)}>
                    <div className="grid min-h-12 grid-cols-[28px_28px_minmax(0,1fr)] items-center gap-1 border-b px-2 text-sm hover:bg-muted/40 sm:min-h-10 sm:grid-cols-[32px_32px_minmax(0,1fr)]">
                      <button
                        aria-label={expanded ? "Collapse channel" : "Expand channel"}
                        className="flex size-8 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-7"
                        type="button"
                        onClick={() => toggleParent(parent)}
                      >
                        <ChevronRight
                          className={cn(
                            "size-4 transition-transform",
                            expanded && "rotate-90",
                          )}
                        />
                      </button>
                      <Checkbox checked={false} disabled />
                      <TouchSafeDropdown
                        trigger={(triggerProps) => (
                          <button
                            aria-label={"Open actions for " + channel.channelName}
                            className="flex min-w-0 items-center gap-2 rounded-md py-2 text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 sm:py-1"
                            disabled={actionBusy}
                            type="button"
                            {...triggerProps}
                          >
                            {expanded ? (
                              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <Folder className="size-4 shrink-0 text-muted-foreground" />
                            )}
                            <span className="min-w-0 truncate font-medium">
                              {channel.channelName}
                            </span>
                          </button>
                        )}
                      >
                        <DropdownMenuContent
                          align="start"
                          className="w-56 max-w-[calc(100vw-2rem)] sm:w-64"
                        >
                          <DropdownMenuItem onSelect={() => openUpload(parent)}>
                            <Upload className="size-4" />
                            Upload File
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => openCreateFolder(parent)}>
                            <Plus className="size-4" />
                            Create Subfolder
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled>
                            <Pencil className="size-4" />
                            Rename Folder
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled>
                            <Trash2 className="size-4" />
                            Delete Folder
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </TouchSafeDropdown>
                    </div>

                    {expanded ? (
                      <TreeChildren
                        actionBusy={actionBusy}
                        childCache={childCache}
                        childrenItems={children}
                        depth={1}
                        expandedKeys={expandedKeys}
                        loading={loading}
                        loadingKeys={loadingKeys}
                        selectedKeys={new Set(Object.keys(selectedFiles))}
                        onCreateFolder={openCreateFolder}
                        onDelete={(item) => setFileAction({ item, type: "delete" })}
                        onDownload={(item) => void downloadFile(item)}
                        onRename={openRename}
                        onToggle={toggleParent}
                        onToggleSelected={toggleSelected}
                        onUpload={openUpload}
                      />
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
        </CardContent>
      </Card>

      <AppModal
        open={Boolean(fileAction)}
        preventClose={actionBusy}
        title={modalTitle}
        footer={
          <>
            <Button
              disabled={actionDisabled}
              type="button"
              variant={
                fileAction?.type === "delete" ||
                fileAction?.type === "delete-selected"
                  ? "destructive"
                  : "default"
              }
              onClick={() => {
                if (isFileActionCreate(fileAction)) {
                  void createFolder()
                }

                if (fileAction?.type === "rename" && isFileActionItem(fileAction)) {
                  void renameItem(fileAction.item)
                }

                if (fileAction?.type === "delete" && isFileActionItem(fileAction)) {
                  void deleteFiles([fileAction.item])
                }

                if (isFileActionDeleteSelected(fileAction)) {
                  void deleteFiles(fileAction.items)
                }
              }}
            >
              {actionBusy ? "Working..." : actionLabel}
            </Button>
            <Button
              disabled={actionBusy}
              type="button"
              variant="outline"
              onClick={closeAction}
            >
              {fileAction?.type === "delete" ||
              fileAction?.type === "delete-selected"
                ? "No"
                : "Cancel"}
            </Button>
          </>
        }
        onClose={closeAction}
      >
        {fileAction?.type === "delete" && isFileActionItem(fileAction) ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              {isFolder(fileAction.item)
                ? "Do you really want to delete this folder? All files inside the deleted folder will be lost."
                : "Do you really want to delete this file?"}
            </p>
            <div className="rounded-md border bg-muted/40 px-3 py-2 font-medium">
              {fileAction.item.name}
            </div>
          </div>
        ) : isFileActionDeleteSelected(fileAction) ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Do you really want to delete all selected files and folders?
            </p>
            <div className="rounded-md border bg-muted/40 px-3 py-2 font-medium">
              {fileAction.items.length} selected
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="file-action-name">
              {isFileActionCreate(fileAction)
                ? "Folder Name"
                : fileAction?.type === "rename" &&
                    isFileActionItem(fileAction) &&
                    isFolder(fileAction.item)
                  ? "Folder"
                  : "File"}
            </Label>
            <Input
              autoFocus
              disabled={actionBusy}
              id="file-action-name"
              value={nameValue}
              onChange={(event) => setNameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return
                }

                event.preventDefault()

                if (isFileActionCreate(fileAction)) {
                  void createFolder()
                }

                if (fileAction?.type === "rename" && isFileActionItem(fileAction)) {
                  void renameItem(fileAction.item)
                }
              }}
            />
          </div>
        )}
      </AppModal>
    </div>
  )
}
