import { MoreVertical, Plus } from "lucide-react"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth } from "@/auth/auth-context"
import { AppModal } from "@/components/app-modal"
import { AppSelect, type AppSelectGroup } from "@/components/app-select"
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

type ChannelGroupRow = {
  cgid: string | number
  name?: string | null
  type: string | number
  [key: string]: unknown
}

type ChannelRow = {
  channelName?: string | null
  cid: string | number
  [key: string]: unknown
}

type ClientDbRow = {
  cldbid: string | number
  clientNickname?: string | null
  clientUniqueIdentifier?: string | null
  [key: string]: unknown
}

type GroupMemberRow = {
  cldbid: string | number
  [key: string]: unknown
}

type CreateChannelGroupForm = {
  name: string
  type: string
}

type EditChannelGroupForm = {
  name: string
  selectedChannel: string
}

type CopyChannelGroupForm = {
  overwrite: boolean
  targetGroupId: string
  targetGroupName: string
  targetGroupType: string
}

const groupTypeOptions = [
  { label: "Regular Group", value: "1" },
  { label: "Template Group", value: "0" },
  { label: "ServerQuery Group", value: "2" },
]

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

function getNumberValue(value: string | number | undefined) {
  const numericValue = Number(value)

  return Number.isFinite(numericValue) ? numericValue : 0
}

function getChannelGroupName(group: ChannelGroupRow) {
  return group.name || `Group ${String(group.cgid)}`
}

function getGroupTypeValue(group: ChannelGroupRow) {
  return Number(group.type)
}

function getGroupTypeRank(type: string | number) {
  switch (Number(type)) {
    case 1:
      return 0
    case 0:
      return 1
    case 2:
      return 2
    default:
      return 3
  }
}

function getGroupSectionLabel(type: string | number) {
  switch (Number(type)) {
    case 1:
      return "Regular Groups"
    case 0:
      return "Template Groups"
    case 2:
      return "ServerQuery Groups"
    default:
      return "Other Groups"
  }
}

function getClientLabel(client: ClientDbRow) {
  return `${client.clientNickname || "Unknown client"} (${String(client.cldbid)})`
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

function createGroupedOptions(groups: ChannelGroupRow[]): AppSelectGroup[] {
  return [1, 0, 2]
    .map((type) => ({
      label: getGroupSectionLabel(type),
      options: groups
        .filter((group) => getGroupTypeValue(group) === type)
        .sort((firstGroup, secondGroup) =>
          getNumberValue(firstGroup.cgid) - getNumberValue(secondGroup.cgid),
        )
        .map((group) => ({
          label: `${getChannelGroupName(group)} (${String(group.cgid)})`,
          value: String(group.cgid),
        })),
    }))
    .filter((group) => group.options.length > 0)
}

export function ChannelGroups() {
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const queryUserRef = useRef(queryUser)
  const selectServerFlightRef = useRef<ReturnType<
    typeof TeamSpeak.useServer
  > | null>(null)
  const loadGroupsFlightRef = useRef<Promise<void> | null>(null)
  const { dismissToast, showError, showSuccess, toasts } = useToastStack()
  const [groups, setGroups] = useState<ChannelGroupRow[]>([])
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [clients, setClients] = useState<ClientDbRow[]>([])
  const [editMembers, setEditMembers] = useState<GroupMemberRow[]>([])
  const [initialEditMembers, setInitialEditMembers] = useState<GroupMemberRow[]>(
    [],
  )
  const [defaultChannelGroupId, setDefaultChannelGroupId] = useState<
    string | number | undefined
  >(undefined)
  const [groupToEdit, setGroupToEdit] = useState<ChannelGroupRow | null>(null)
  const [groupToCopy, setGroupToCopy] = useState<ChannelGroupRow | null>(null)
  const [groupToDelete, setGroupToDelete] = useState<ChannelGroupRow | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [copyDialogOpen, setCopyDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [memberLoading, setMemberLoading] = useState(false)
  const [createForm, setCreateForm] = useState<CreateChannelGroupForm>({
    name: "",
    type: "1",
  })
  const [editForm, setEditForm] = useState<EditChannelGroupForm>({
    name: "",
    selectedChannel: "",
  })
  const [copyForm, setCopyForm] = useState<CopyChannelGroupForm>({
    overwrite: false,
    targetGroupId: "",
    targetGroupName: "",
    targetGroupType: "1",
  })
  const [forceDeletion, setForceDeletion] = useState(false)
  const [memberFilter, setMemberFilter] = useState("")
  const [availableClientFilter, setAvailableClientFilter] = useState("")

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

  const groupedGroupOptions = useMemo(() => createGroupedOptions(groups), [groups])

  const selectedTargetGroup = useMemo(
    () => groups.find((group) => String(group.cgid) === copyForm.targetGroupId),
    [copyForm.targetGroupId, groups],
  )

  const channelOptions = useMemo(
    () =>
      channels.map((channel) => ({
        label: channel.channelName || `Channel ${String(channel.cid)}`,
        value: String(channel.cid),
      })),
    [channels],
  )

  const sortedGroups = useMemo(
    () =>
      [...groups].sort((firstGroup, secondGroup) => {
        const typeDiff =
          getGroupTypeRank(firstGroup.type) - getGroupTypeRank(secondGroup.type)
        if (typeDiff !== 0) return typeDiff

        return getNumberValue(firstGroup.cgid) - getNumberValue(secondGroup.cgid)
      }),
    [groups],
  )

  const memberIdSet = useMemo(
    () => new Set(editMembers.map((member) => String(member.cldbid))),
    [editMembers],
  )

  const memberClients = useMemo(() => {
    const normalizedFilter = memberFilter.trim().toLowerCase()

    return clients.filter((client) => {
      const isMember = memberIdSet.has(String(client.cldbid))
      if (!isMember) return false
      if (!normalizedFilter) return true

      return getClientLabel(client).toLowerCase().includes(normalizedFilter)
    })
  }, [clients, memberFilter, memberIdSet])

  const availableClients = useMemo(() => {
    const normalizedFilter = availableClientFilter.trim().toLowerCase()

    return clients.filter((client) => {
      const isMember = memberIdSet.has(String(client.cldbid))
      if (isMember) return false
      if (!normalizedFilter) return true

      return getClientLabel(client).toLowerCase().includes(normalizedFilter)
    })
  }, [availableClientFilter, clients, memberIdSet])

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

  const loadGroups = useCallback(
    async (progress: "foreground" | "background" = "foreground") => {
      if (!loadGroupsFlightRef.current) {
        loadGroupsFlightRef.current = (async () => {
          await ensureSelectedServer()

          try {
            const groupList = await TeamSpeak.execute<ChannelGroupRow[]>(
              "channelgrouplist",
              {},
              [],
              { progress },
            )

            setGroups(Array.isArray(groupList) ? groupList : [])
          } catch (error) {
            if (isDatabaseEmptyResult(error)) {
              setGroups([])
            } else {
              throw error
            }
          }
        })().finally(() => {
          loadGroupsFlightRef.current = null
        })
      }

      return loadGroupsFlightRef.current
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
    loadGroups()
      .catch((error: unknown) => {
        if (active) showError(getErrorMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [loadGroups, selectedServerId, showError])

  const resetCreateForm = () => {
    setCreateForm({ name: "", type: "1" })
  }

  const closeAddDialog = () => {
    if (submitting) return
    setAddDialogOpen(false)
    resetCreateForm()
  }

  const loadChannelMembers = useCallback(
    async (channelId: string, groupId: string | number) => {
      if (!channelId) {
        setEditMembers([])
        setInitialEditMembers([])
        return
      }

      setMemberLoading(true)

      try {
        await ensureSelectedServer()
        const groupMembers = await TeamSpeak.execute<GroupMemberRow[]>(
          "channelgroupclientlist",
          {
            cgid: groupId,
            cid: channelId,
          },
        ).catch((error: unknown) => {
          if (isDatabaseEmptyResult(error)) return []
          throw error
        })

        setEditMembers(Array.isArray(groupMembers) ? groupMembers : [])
        setInitialEditMembers(Array.isArray(groupMembers) ? groupMembers : [])
      } catch (error) {
        showError(getErrorMessage(error))
      } finally {
        setMemberLoading(false)
      }
    },
    [ensureSelectedServer, showError],
  )

  const openEditDialog = async (group: ChannelGroupRow) => {
    setGroupToEdit(group)
    setEditForm({ name: getChannelGroupName(group), selectedChannel: "" })
    setEditMembers([])
    setInitialEditMembers([])
    setMemberFilter("")
    setAvailableClientFilter("")
    setEditDialogOpen(true)
    setEditLoading(true)

    try {
      await ensureSelectedServer()
      const [serverInfo, channelList, clientList] = await Promise.all([
        TeamSpeak.execute<Array<{ virtualserverDefaultChannelGroup?: string | number }>>(
          "serverinfo",
        ),
        TeamSpeak.execute<ChannelRow[]>("channellist"),
        fullClientDBList(),
      ])

      setDefaultChannelGroupId(serverInfo[0]?.virtualserverDefaultChannelGroup)
      setChannels(Array.isArray(channelList) ? channelList : [])
      setClients(clientList)
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setEditLoading(false)
    }
  }

  const closeEditDialog = () => {
    if (submitting) return
    setEditDialogOpen(false)
    setGroupToEdit(null)
    setEditForm({ name: "", selectedChannel: "" })
    setEditMembers([])
    setInitialEditMembers([])
  }

  const openCopyDialog = (group: ChannelGroupRow) => {
    setGroupToCopy(group)
    setCopyForm({
      overwrite: false,
      targetGroupId: "",
      targetGroupName: "",
      targetGroupType: "1",
    })
    setCopyDialogOpen(true)
  }

  const closeCopyDialog = () => {
    if (submitting) return
    setCopyDialogOpen(false)
    setGroupToCopy(null)
  }

  const openDeleteDialog = (group: ChannelGroupRow) => {
    setGroupToDelete(group)
    setForceDeletion(false)
    setDeleteDialogOpen(true)
  }

  const closeDeleteDialog = () => {
    if (submitting) return
    setDeleteDialogOpen(false)
    setGroupToDelete(null)
    setForceDeletion(false)
  }

  const createGroup = async () => {
    const name = createForm.name.trim()
    if (!name) {
      showError("Enter group name first.")
      return
    }

    setSubmitting(true)

    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("channelgroupadd", {
        name,
        type: Number(createForm.type),
      })

      showSuccess("Channel group created")
      setAddDialogOpen(false)
      resetCreateForm()
      await loadGroups("background")
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const saveGroup = async () => {
    if (!groupToEdit) {
      closeEditDialog()
      return
    }

    const name = editForm.name.trim()
    if (!name) {
      showError("Enter group name first.")
      return
    }

    setSubmitting(true)

    try {
      await ensureSelectedServer()

      if (name !== getChannelGroupName(groupToEdit)) {
        await TeamSpeak.execute("channelgrouprename", {
          cgid: groupToEdit.cgid,
          name,
        })
      }

      if (editForm.selectedChannel) {
        const nextMemberIds = new Set(
          editMembers.map((member) => String(member.cldbid)),
        )
        const previousMemberIds = new Set(
          initialEditMembers.map((member) => String(member.cldbid)),
        )
        const membersToRemove = initialEditMembers.filter(
          (member) => !nextMemberIds.has(String(member.cldbid)),
        )
        const membersToAdd = editMembers.filter(
          (member) => !previousMemberIds.has(String(member.cldbid)),
        )

        for (const member of membersToRemove) {
          await TeamSpeak.execute("setclientchannelgroup", {
            cgid: defaultChannelGroupId,
            cid: editForm.selectedChannel,
            cldbid: member.cldbid,
          })
        }

        for (const member of membersToAdd) {
          await TeamSpeak.execute("setclientchannelgroup", {
            cgid: groupToEdit.cgid,
            cid: editForm.selectedChannel,
            cldbid: member.cldbid,
          })
        }
      }

      showSuccess("Channel group updated")
      setEditDialogOpen(false)
      setGroupToEdit(null)
      await loadGroups("background")
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const copyGroup = async () => {
    if (!groupToCopy) {
      closeCopyDialog()
      return
    }

    const name = copyForm.targetGroupName.trim()
    if (!name) {
      showError("Enter target group name first.")
      return
    }

    setSubmitting(true)

    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("channelgroupcopy", {
        name,
        scgid: groupToCopy.cgid,
        tcgid: copyForm.overwrite && selectedTargetGroup ? selectedTargetGroup.cgid : 0,
        type: Number(copyForm.targetGroupType),
      })

      showSuccess("Channel group copied")
      setCopyDialogOpen(false)
      setGroupToCopy(null)
      await loadGroups("background")
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const deleteGroup = async () => {
    if (!groupToDelete) {
      closeDeleteDialog()
      return
    }

    setSubmitting(true)

    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("channelgroupdel", {
        cgid: groupToDelete.cgid,
        force: forceDeletion ? 1 : 0,
      })

      showSuccess("Channel group deleted")
      setDeleteDialogOpen(false)
      setGroupToDelete(null)
      setForceDeletion(false)
      await loadGroups("background")
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const addMember = (client: ClientDbRow) => {
    setEditMembers((currentMembers) =>
      currentMembers.some((member) => String(member.cldbid) === String(client.cldbid))
        ? currentMembers
        : [...currentMembers, { cldbid: client.cldbid }],
    )
  }

  const removeMember = (client: ClientDbRow) => {
    setEditMembers((currentMembers) =>
      currentMembers.filter(
        (member) => String(member.cldbid) !== String(client.cldbid),
      ),
    )
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="button" onClick={() => setAddDialogOpen(true)}>
              <Plus className="size-4" />
              Add Channel Group
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="space-y-2 px-3 pb-3 md:hidden">
            {loading ? (
              <div className="rounded-md border p-4 text-center text-sm text-muted-foreground">
                ...loading
              </div>
            ) : groups.length ? (
              sortedGroups.map((group, index) => {
                const previousGroup = sortedGroups[index - 1]
                const showSection =
                  !previousGroup ||
                  getGroupTypeValue(previousGroup) !== getGroupTypeValue(group)

                return (
                  <Fragment key={String(group.cgid)}>
                    {showSection ? (
                      <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:pt-0">
                        {getGroupSectionLabel(group.type)}
                      </div>
                    ) : null}
                    <div className="space-y-3 rounded-md border p-3 text-sm">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div
                          className="min-w-0 flex-1 truncate font-medium"
                          title={getChannelGroupName(group)}
                        >
                          {getChannelGroupName(group)}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              className="shrink-0"
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                            >
                              <MoreVertical className="size-4" />
                              <span className="sr-only">
                                Open channel group actions
                              </span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openEditDialog(group)}>
                              Edit Group
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openCopyDialog(group)}>
                              Copy Group
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => openDeleteDialog(group)}
                            >
                              Delete Group
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="shrink-0 text-muted-foreground">ID</span>
                          <span className="min-w-0 max-w-[68%] break-words text-right">
                            {group.cgid}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="shrink-0 text-muted-foreground">
                            Type
                          </span>
                          <span className="min-w-0 max-w-[68%] break-words text-right">
                            {getGroupSectionLabel(group.type)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Fragment>
                )
              })
            ) : (
              <div className="rounded-md border p-4 text-center text-sm text-muted-foreground">
                No channel groups found.
              </div>
            )}
          </div>
          <div className="hidden max-w-full overflow-x-auto px-3 pb-2 sm:px-6 md:block">
            <Table className="w-full min-w-[520px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10" />
                  <TableHead className="min-w-[18rem]">Name</TableHead>
                  <TableHead className="w-24">ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      className="h-32 text-center text-muted-foreground"
                      colSpan={3}
                    >
                      ...loading
                    </TableCell>
                  </TableRow>
                ) : groups.length ? (
                  sortedGroups.map((group, index) => {
                    const previousGroup = sortedGroups[index - 1]
                    const showSection =
                      !previousGroup ||
                      getGroupTypeValue(previousGroup) !== getGroupTypeValue(group)

                    return (
                      <Fragment key={String(group.cgid)}>
                        {showSection ? (
                          <TableRow>
                            <TableCell
                              className="bg-muted/40 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                              colSpan={3}
                            >
                              {getGroupSectionLabel(group.type)}
                            </TableCell>
                          </TableRow>
                        ) : null}
                        <TableRow>
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
                                    Open channel group actions
                                  </span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                <DropdownMenuItem onSelect={() => openEditDialog(group)}>
                                  Edit Group
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => openCopyDialog(group)}>
                                  Copy Group
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => openDeleteDialog(group)}
                                >
                                  Delete Group
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                          <TableCell
                            className="max-w-[22rem] truncate font-medium"
                            title={getChannelGroupName(group)}
                          >
                            {getChannelGroupName(group)}
                          </TableCell>
                          <TableCell>{group.cgid}</TableCell>
                        </TableRow>
                      </Fragment>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      className="h-32 text-center text-muted-foreground"
                      colSpan={3}
                    >
                      No channel groups found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AppModal
        open={addDialogOpen}
        preventClose={submitting}
        title="Add Group"
        footer={
          <>
            <Button
              disabled={submitting || !createForm.name.trim()}
              type="button"
              onClick={createGroup}
            >
              {submitting ? "Adding..." : "Add"}
            </Button>
            <Button
              disabled={submitting}
              type="button"
              variant="outline"
              onClick={closeAddDialog}
            >
              Cancel
            </Button>
          </>
        }
        onClose={closeAddDialog}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="channel-group-name">Group Name</Label>
            <Input
              id="channel-group-name"
              disabled={submitting}
              value={createForm.name}
              onChange={(event) =>
                setCreateForm((currentForm) => ({
                  ...currentForm,
                  name: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Group Type</Label>
            <AppSelect
              disabled={submitting}
              options={groupTypeOptions}
              value={createForm.type}
              onChange={(value) =>
                setCreateForm((currentForm) => ({ ...currentForm, type: value }))
              }
            />
          </div>
        </div>
      </AppModal>

      <AppModal
        className="max-w-3xl"
        open={editDialogOpen}
        preventClose={submitting}
        title="Channel Group Edit"
        footer={
          <>
            <Button
              disabled={submitting || editLoading || !editForm.name.trim()}
              type="button"
              onClick={saveGroup}
            >
              {submitting ? "Saving..." : "OK"}
            </Button>
            <Button
              disabled={submitting}
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
            <Label htmlFor="edit-channel-group-name">Channel Group Name</Label>
            <Input
              id="edit-channel-group-name"
              disabled={submitting || editLoading}
              value={editForm.name}
              onChange={(event) =>
                setEditForm((currentForm) => ({
                  ...currentForm,
                  name: event.target.value,
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label>Channel</Label>
            <AppSelect
              disabled={submitting || editLoading}
              options={channelOptions}
              placeholder="Select channel"
              value={editForm.selectedChannel}
              onChange={(value) => {
                setEditForm((currentForm) => ({
                  ...currentForm,
                  selectedChannel: value,
                }))
                if (groupToEdit) {
                  void loadChannelMembers(value, groupToEdit.cgid)
                }
              }}
            />
          </div>

          <div className="min-w-0 max-w-full overflow-hidden rounded-md border p-3 sm:p-4">
            <div className="mb-3">
              <div className="text-sm font-medium pb-3">Members</div>
            </div>

            {editLoading || memberLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                ...loading
              </div>
            ) : !editForm.selectedChannel ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Member editing is disabled until a channel is selected.
              </div>
            ) : groupToEdit && getGroupTypeValue(groupToEdit) !== 1 ? (
              <div className="space-y-2">
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Member editing is disabled for this group type.
                </div>
                <div className="max-h-64 min-w-0 max-w-full space-y-1 overflow-y-auto rounded-md border p-2">
                  {memberClients.length ? (
                    memberClients.map((client) => (
                      <label
                        className="flex min-w-0 cursor-not-allowed items-start gap-2 rounded px-2 py-1.5 text-sm opacity-70"
                        key={String(client.cldbid)}
                      >
                        <Checkbox checked disabled />
                        <span className="min-w-0 flex-1">
                          <span className="block max-w-full truncate">
                            {getClientLabel(client)}
                          </span>
                          <span className="block max-w-full truncate text-xs text-muted-foreground">
                            {client.clientUniqueIdentifier}
                          </span>
                        </span>
                      </label>
                    ))
                  ) : (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      No members found.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid min-w-0 max-w-full gap-4 md:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="channel-group-member-filter">Current members</Label>
                  <Input
                    className="min-w-0"
                    id="channel-group-member-filter"
                    disabled={submitting}
                    placeholder="Search members"
                    value={memberFilter}
                    onChange={(event) => setMemberFilter(event.target.value)}
                  />
                  <div className="max-h-64 min-w-0 max-w-full space-y-1 overflow-y-auto rounded-md border p-2">
                    {memberClients.length ? (
                      memberClients.map((client) => (
                        <label
                          className="flex min-w-0 cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary/70"
                          key={String(client.cldbid)}
                        >
                          <Checkbox
                            checked
                            disabled={submitting}
                            onCheckedChange={(checked) => {
                              if (checked !== true) removeMember(client)
                            }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block max-w-full truncate">
                              {getClientLabel(client)}
                            </span>
                            <span className="block max-w-full truncate text-xs text-muted-foreground">
                              {client.clientUniqueIdentifier}
                            </span>
                          </span>
                        </label>
                      ))
                    ) : (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        No members found.
                      </div>
                    )}
                  </div>
                </div>

                <div className="min-w-0 space-y-2">
                  <Label htmlFor="channel-group-available-filter">
                    Available clients
                  </Label>
                  <Input
                    className="min-w-0"
                    id="channel-group-available-filter"
                    disabled={submitting}
                    placeholder="Search clients"
                    value={availableClientFilter}
                    onChange={(event) =>
                      setAvailableClientFilter(event.target.value)
                    }
                  />
                  <div className="max-h-64 min-w-0 max-w-full space-y-1 overflow-y-auto rounded-md border p-2">
                    {availableClients.length ? (
                      availableClients.map((client) => (
                        <label
                          className="flex min-w-0 cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary/70"
                          key={String(client.cldbid)}
                        >
                          <Checkbox
                            checked={false}
                            disabled={submitting}
                            onCheckedChange={(checked) => {
                              if (checked === true) addMember(client)
                            }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block max-w-full truncate">
                              {getClientLabel(client)}
                            </span>
                            <span className="block max-w-full truncate text-xs text-muted-foreground">
                              {client.clientUniqueIdentifier}
                            </span>
                          </span>
                        </label>
                      ))
                    ) : (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        No available clients found.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </AppModal>

      <AppModal
        open={copyDialogOpen}
        preventClose={submitting}
        title="Copy Group"
        footer={
          <>
            <Button
              disabled={submitting || !copyForm.targetGroupName.trim()}
              type="button"
              onClick={copyGroup}
            >
              {submitting ? "Copying..." : "OK"}
            </Button>
            <Button
              disabled={submitting}
              type="button"
              variant="outline"
              onClick={closeCopyDialog}
            >
              Cancel
            </Button>
          </>
        }
        onClose={closeCopyDialog}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Copy Group</Label>
            <Input
              disabled
              value={
                groupToCopy
                  ? `${getChannelGroupName(groupToCopy)} (${groupToCopy.cgid})`
                  : ""
              }
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={copyForm.overwrite}
              disabled={submitting}
              onCheckedChange={(checked) =>
                setCopyForm((currentForm) => {
                  const overwrite = checked === true
                  const nextTarget = overwrite ? selectedTargetGroup : undefined

                  return {
                    ...currentForm,
                    overwrite,
                    targetGroupName:
                      overwrite && nextTarget
                        ? getChannelGroupName(nextTarget)
                        : currentForm.targetGroupName,
                    targetGroupType:
                      overwrite && nextTarget
                        ? String(nextTarget.type)
                        : currentForm.targetGroupType,
                  }
                })
              }
            />
            Overwrite
          </label>
          <div className="space-y-2">
            <Label>Target Group</Label>
            <AppSelect
              disabled={submitting || !copyForm.overwrite}
              groups={groupedGroupOptions}
              placeholder="Select target group"
              value={copyForm.targetGroupId}
              onChange={(value) => {
                const group = groups.find(
                  (currentGroup) => String(currentGroup.cgid) === value,
                )
                setCopyForm((currentForm) => ({
                  ...currentForm,
                  targetGroupId: value,
                  targetGroupName: group
                    ? getChannelGroupName(group)
                    : currentForm.targetGroupName,
                  targetGroupType: group
                    ? String(group.type)
                    : currentForm.targetGroupType,
                }))
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="copy-channel-group-target-name">
              Target Group Name
            </Label>
            <Input
              id="copy-channel-group-target-name"
              disabled={submitting || copyForm.overwrite}
              value={copyForm.targetGroupName}
              onChange={(event) =>
                setCopyForm((currentForm) => ({
                  ...currentForm,
                  targetGroupName: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Target Group Type</Label>
            <AppSelect
              disabled={submitting || copyForm.overwrite}
              options={groupTypeOptions}
              value={copyForm.targetGroupType}
              onChange={(value) =>
                setCopyForm((currentForm) => ({
                  ...currentForm,
                  targetGroupType: value,
                }))
              }
            />
          </div>
        </div>
      </AppModal>

      <AppModal
        open={deleteDialogOpen}
        preventClose={submitting}
        title="Confirm Delete Group"
        footer={
          <>
            <Button
              disabled={submitting}
              type="button"
              variant="destructive"
              onClick={deleteGroup}
            >
              {submitting ? "Deleting..." : "Delete Group"}
            </Button>
            <Button
              disabled={submitting}
              type="button"
              variant="outline"
              onClick={closeDeleteDialog}
            >
              Cancel
            </Button>
          </>
        }
        onClose={closeDeleteDialog}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Please confirm deleting the group{" "}
            <span className="font-semibold text-foreground">
              {groupToDelete ? getChannelGroupName(groupToDelete) : ""}
            </span>
          </p>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={forceDeletion}
              disabled={submitting}
              onCheckedChange={(checked) => setForceDeletion(checked === true)}
            />
            Delete even if there are clients in the group
          </label>
        </div>
      </AppModal>
    </div>
  )
}
