import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import {
  Ban,
  Blocks,
  ChevronDown,
  ClipboardList,
  Code2,
  Server,
  Eye,
  CloudBackup,
  FileKey2,
  Folder,
  KeyRound,
  LogOut,
  Menu,
  MessageSquare,
  MonitorCog,
  ShieldCheck,
  TerminalSquare,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import logoDarkUrl from "@/assets/logo-dark.svg"
import logoLightUrl from "@/assets/logo-light.svg"

type NavItem = {
  title: string
  path: string
  icon: LucideIcon
}

const mainNavigation: NavItem[] = [
  { title: "Server List", path: "/servers", icon: Server },
  { title: "Server Viewer", path: "/serverviewer", icon: Eye },
  { title: "Chat", path: "/chat", icon: MessageSquare },
  { title: "File Browser", path: "/files", icon: Folder },
  { title: "Server Log", path: "/logs", icon: ClipboardList },
  { title: "Backup/Restore", path: "/snapshot", icon: CloudBackup },
  { title: "Server Query", path: "/console", icon: TerminalSquare },
  { title: "Privilege Keys", path: "/tokens", icon: KeyRound },
  { title: "API Keys", path: "/apikeys", icon: FileKey2 },
  { title: "Ban List", path: "/bans", icon: Ban },
  { title: "Complaints List", path: "/complaints", icon: ShieldCheck },
  { title: "List All Clients", path: "/clients", icon: User },
  { title: "Server Groups", path: "/servergroups", icon: Users },
  { title: "Channel Groups", path: "/channelgroups", icon: MonitorCog },
]

const APP_VERSION = `v${__APP_VERSION__}`

const permissionNavigation: NavItem[] = [
  {
    title: "Server Group",
    path: "/permissions/servergroup",
    icon: Users,
  },
  {
    title: "Client Permissions",
    path: "/permissions/client",
    icon: User,
  },
  {
    title: "Channel Permissions",
    path: "/permissions/channel",
    icon: Blocks,
  },
  {
    title: "Channel Groups",
    path: "/permissions/channelgroup",
    icon: MonitorCog,
  },
  {
    title: "Channel Client Permissions",
    path: "/permissions/channel/client",
    icon: Code2,
  },
]

function isChannelClientPath(path: string) {
  return /^\/permissions\/channel\/(client|[^/]+\/client)(\/|$)/.test(path)
}

function isActivePath(currentPath: string, itemPath: string) {
  if (itemPath === "/permissions/channel/client") {
    return isChannelClientPath(currentPath)
  }

  if (itemPath === "/permissions/channel" && isChannelClientPath(currentPath)) {
    return false
  }

  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`)
}

function NavItemLink({
  item,
  compact = false,
  onNavigate,
}: {
  item: NavItem
  compact?: boolean
  onNavigate?: () => void
}) {
  const location = useLocation()
  const active = isActivePath(location.pathname, item.path)
  const Icon = item.icon

  return (
    <Button
      asChild
      variant={active ? "secondary" : "ghost"}
      className={cn(
        "h-9 w-full justify-start gap-2 px-2.5",
        compact && "h-8 w-auto shrink-0 px-3",
        active && "font-semibold",
      )}
    >
      <NavLink to={item.path} onClick={onNavigate}>
        <Icon className="size-4 shrink-0" />
        <span>{item.title}</span>
      </NavLink>
    </Button>
  )
}

function NavigationSection({
  items,
  onNavigate,
}: {
  items: NavItem[]
  onNavigate?: () => void
}) {
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <NavItemLink item={item} key={item.path} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

function PermissionsNavigationSection({
  onNavigate,
}: {
  onNavigate?: () => void
}) {
  const location = useLocation()
  const isPermissionsRoute = location.pathname.startsWith("/permissions")
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant={isPermissionsRoute ? "secondary" : "ghost"}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "h-9 w-full justify-start gap-2 px-2.5",
          isPermissionsRoute && "font-semibold",
        )}
      >
        <KeyRound className="size-4 shrink-0" />
        <span className="flex-1 text-left">Permissions</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </Button>

      {open ? (
        <div className="ml-4 space-y-1 border-l pl-2">
          {permissionNavigation.map((item) => (
            <NavItemLink
              item={item}
              key={item.path}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full w-72 flex-col border-r bg-card text-card-foreground">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 min-w-0 items-center">
          <img
            src={logoDarkUrl}
            alt="TSPanelio"
            className="h-8 w-auto dark:hidden"
            draggable={false}
          />
          <img
            src={logoLightUrl}
            alt="TSPanelio"
            className="hidden h-8 w-auto dark:block"
            draggable={false}
          />
        </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">
              TSPanelio
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {APP_VERSION}
            </div>
          </div>
        </div>
      </div>

      <Separator className="shrink-0" />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-3 py-3">
          <NavigationSection items={mainNavigation} onNavigate={onNavigate} />
          <PermissionsNavigationSection onNavigate={onNavigate} />
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t p-3">
        <NavItemLink
          item={{ title: "Logout", path: "/logout", icon: LogOut }}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  )
}

function Sidebar({ open }: { open: boolean }) {
  return (
    <aside
      aria-hidden={!open}
      className={cn(
        "hidden h-dvh shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out lg:block",
        open ? "w-72" : "w-0",
      )}
    >
      <div
        className={cn(
          "h-full w-72 transition-transform duration-200 ease-in-out will-change-transform",
          open ? "translate-x-0" : "pointer-events-none -translate-x-full",
        )}
      >
        <SidebarContent />
      </div>
    </aside>
  )
}

function MobileSidebar({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onOpenChange, open])

  return (
    <div
      aria-hidden={!open}
      className={cn(
        "fixed inset-0 z-50 lg:hidden",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
    >
      <div
        className={cn(
          "absolute inset-0 bg-background/70 transition-opacity duration-300 ease-in-out",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={() => onOpenChange(false)}
      />
      <div
        className={cn(
          "relative h-full w-72 transition-transform duration-300 ease-in-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <SidebarContent onNavigate={() => onOpenChange(false)} />
        <Button
          aria-label="Close sidebar"
          className="absolute right-3 top-3"
          size="icon"
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}

export function AppLayout() {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") {
      return true
    }

    return window.localStorage.getItem("tspanelio:sidebar-open") !== "false"
  })
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  useEffect(() => {
    window.localStorage.setItem(
      "tspanelio:sidebar-open",
      String(sidebarOpen),
    )
  }, [sidebarOpen])

  useEffect(() => {
    setMobileSidebarOpen(false)
  }, [location.pathname])

  return (
    <div className="h-dvh overflow-hidden bg-background text-foreground">
      <div className="flex h-dvh min-h-0">
        <Sidebar open={sidebarOpen} />

        <div className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                aria-label="Open sidebar"
                className="inline-flex lg:hidden"
                size="icon"
                type="button"
                variant="ghost"
                onClick={() => setMobileSidebarOpen(true)}
              >
                <Menu className="size-4" />
              </Button>

              <Button
                aria-label="Toggle sidebar"
                className="hidden lg:inline-flex"
                size="icon"
                type="button"
                variant="ghost"
                onClick={() => setSidebarOpen((current) => !current)}
              >
                <Menu className="size-4" />
              </Button>

            </div>

            <div className="flex shrink-0 items-center gap-2">
              <ThemeToggle />
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>

      <MobileSidebar open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen} />
    </div>
  )
}
