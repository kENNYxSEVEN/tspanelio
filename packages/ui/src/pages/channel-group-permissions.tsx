import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth } from "@/auth/auth-context"
import {
  PermissionPageFlow,
  type Permission,
  type PermissionEditValues,
} from "@/components/permission-page-flow"
import { ToastStack, useToastStack } from "@/components/toast-stack"

type ChannelGroup = {
  cgid: string | number
  name: string
  type: string | number
  [key: string]: unknown
}

const availablePermissionCache = new Map<string, Permission[]>()
const availablePermissionFlights = new Map<string, Promise<Permission[]>>()
const groupCache = new Map<string, ChannelGroup[]>()
const groupFlights = new Map<string, Promise<ChannelGroup[]>>()
const permissionCache = new Map<string, Permission[]>()
const permissionFlights = new Map<string, Promise<Permission[]>>()

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

function toChannelGroupOption(group: ChannelGroup) {
  return {
    label: `${group.name} (${group.cgid})`,
    value: String(group.cgid),
  }
}

export function ChannelGroupPermissions() {
  const navigate = useNavigate()
  const { cgid } = useParams()
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const queryUserRef = useRef(queryUser)
  const selectServerFlightRef = useRef<ReturnType<
    typeof TeamSpeak.useServer
  > | null>(null)
  const { dismissToast, showError, toasts } = useToastStack()
  const [availablePermissions, setAvailablePermissions] = useState<Permission[]>([])
  const [grantedPermissions, setGrantedPermissions] = useState<Permission[]>([])
  const [groups, setGroups] = useState<ChannelGroup[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [entityLoading, setEntityLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    queryUserRef.current = queryUser
  }, [queryUser])

  const selectedServerId = useMemo(() => {
    if (isUsableServerId(queryUser.virtualserverId)) return queryUser.virtualserverId
    if (isUsableServerId(serverId)) return serverId
    return undefined
  }, [queryUser.virtualserverId, serverId])

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
      ).finally(() => {
        selectServerFlightRef.current = null
      })
    }

    await selectServerFlightRef.current
    saveServerId(validSelectedServerId)

    void TeamSpeak.ensureQueryIdentity({ progress: "background" })
      .then((nextQueryUser) => {
        if (nextQueryUser) {
          queryUserRef.current = nextQueryUser
          saveQueryUser(nextQueryUser)
        }
      })
      .catch(() => undefined)

    return queryUserRef.current
  }, [saveQueryUser, saveServerId, selectedServerId])

  const serverCacheKey = selectedServerId ? String(selectedServerId) : "__unknown__"

  const loadAvailablePermissions = useCallback(async () => {
    await ensureSelectedServer()
    const cached = availablePermissionCache.get(serverCacheKey)
    if (cached) return cached

    let flight = availablePermissionFlights.get(serverCacheKey)
    if (!flight) {
      flight = TeamSpeak.execute<Permission[]>("permissionlist")
        .then((permissions) => {
          availablePermissionCache.set(serverCacheKey, permissions)
          return permissions
        })
        .finally(() => availablePermissionFlights.delete(serverCacheKey))

      availablePermissionFlights.set(serverCacheKey, flight)
    }

    return flight
  }, [ensureSelectedServer, serverCacheKey])

  const loadGroups = useCallback(async () => {
    await ensureSelectedServer()
    const cached = groupCache.get(serverCacheKey)
    if (cached) return cached

    let flight = groupFlights.get(serverCacheKey)
    if (!flight) {
      flight = TeamSpeak.execute<ChannelGroup[]>("channelgrouplist")
        .then((nextGroups) => {
          groupCache.set(serverCacheKey, nextGroups)
          return nextGroups
        })
        .finally(() => groupFlights.delete(serverCacheKey))

      groupFlights.set(serverCacheKey, flight)
    }

    return flight
  }, [ensureSelectedServer, serverCacheKey])

  const getPermissions = useCallback(
    async (groupId: string | number) => {
      const key = serverCacheKey + ":channelgroup:" + String(groupId)
      const cached = permissionCache.get(key)
      if (cached) return cached

      let flight = permissionFlights.get(key)
      if (!flight) {
        flight = ensureSelectedServer()
          .then(() =>
            TeamSpeak.execute<Permission[]>("channelgrouppermlist", {
              cgid: groupId,
            }),
          )
          .then((permissions) => {
            permissionCache.set(key, permissions)
            return permissions
          })
          .finally(() => permissionFlights.delete(key))

        permissionFlights.set(key, flight)
      }

      return flight
    },
    [ensureSelectedServer, serverCacheKey],
  )

  const refreshPermissions = useCallback(
    async (groupId: string | number) => {
      const key = serverCacheKey + ":channelgroup:" + String(groupId)
      permissionCache.delete(key)
      permissionFlights.delete(key)
      const permissions = await TeamSpeak.execute<Permission[]>(
        "channelgrouppermlist",
        { cgid: groupId },
      )
      permissionCache.set(key, permissions)
      return permissions
    },
    [serverCacheKey],
  )

  useEffect(() => {
    let active = true
    setInitialLoading(availablePermissions.length === 0 || groups.length === 0)

    const availablePermissionsPromise = loadAvailablePermissions()
      .then((permissions) => {
        if (!active) return
        setAvailablePermissions(permissions)
      })
      .catch((error: unknown) => active && showError(getErrorMessage(error)))

    const groupsPromise = loadGroups()
      .then((data) => {
        if (!active) return
        setGroups(data)
        if (!cgid && data[0]) {
          void getPermissions(data[0].cgid).then((permissions) => {
            if (active) setGrantedPermissions(permissions)
          })
          navigate("/permissions/channelgroup/" + String(data[0].cgid), {
            replace: true,
          })
        }
      })
      .catch((error: unknown) => active && showError(getErrorMessage(error)))

    Promise.allSettled([availablePermissionsPromise, groupsPromise]).finally(
      () => active && setInitialLoading(false),
    )

    return () => {
      active = false
    }
  }, [availablePermissions.length, cgid, getPermissions, groups.length, loadAvailablePermissions, loadGroups, navigate, showError])

  useEffect(() => {
    if (!cgid) return
    let active = true
    const key = serverCacheKey + ":channelgroup:" + String(cgid)
    const cached = permissionCache.get(key)
    if (cached) {
      setGrantedPermissions(cached)
      setEntityLoading(false)
      return () => {
        active = false
      }
    }

    setEntityLoading(true)
    getPermissions(cgid)
      .then((permissions) => active && setGrantedPermissions(permissions))
      .catch((error: unknown) => active && showError(getErrorMessage(error)))
      .finally(() => active && setEntityLoading(false))

    return () => {
      active = false
    }
  }, [cgid, getPermissions, serverCacheKey, showError])

  const savePermission = async (
    permission: Permission,
    values: PermissionEditValues,
  ) => {
    if (!cgid) return
    setSubmitting(true)
    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("channelgroupaddperm", {
        cgid,
        permid: permission.permid,
        permvalue: Number(values.permvalue),
      })
      setGrantedPermissions(await refreshPermissions(cgid))
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const removePermission = async (permission: Permission) => {
    if (!cgid) return
    setSubmitting(true)
    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("channelgroupdelperm", {
        cgid,
        permid: permission.permid,
      })
      setGrantedPermissions(await refreshPermissions(cgid))
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const groupedChannelGroupOptions = [
    {
      label: "Regular Groups",
      options: groups
        .filter((group) => Number(group.type) === 1)
        .map(toChannelGroupOption),
    },
    {
      label: "Template Groups",
      options: groups
        .filter((group) => Number(group.type) === 0)
        .map(toChannelGroupOption),
    },
    {
      label: "ServerQuery Groups",
      options: groups
        .filter((group) => Number(group.type) === 2)
        .map(toChannelGroupOption),
    },
  ]

  return (
    <>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <PermissionPageFlow
        availablePermissions={availablePermissions}
        busy={
          entityLoading ||
          submitting ||
          (initialLoading && grantedPermissions.length === 0)
        }
        editableFields={["permvalue"]}
        grantedPermissions={grantedPermissions}
        loading={
          initialLoading &&
          availablePermissions.length === 0 &&
          grantedPermissions.length === 0
        }
        selectors={[
          {
            groups: groupedChannelGroupOptions,
            label: "Channel Group",
            value: cgid ?? "",
            onChange: (value) => navigate("/permissions/channelgroup/" + value),
          },
        ]}
        submitting={submitting}
        title="Channel Group Permissions"
        onRemove={removePermission}
        onSave={savePermission}
      />
    </>
  )
}
