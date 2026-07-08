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

type ServerGroupRow = {
  name?: string | null
  sgid: string | number
  type: string | number
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

type CreateServerGroupForm = {
  name: string
  type: string
}

type EditServerGroupForm = {
  name: string
}

type CopyServerGroupForm = {
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

function getGroupName(group: ServerGroupRow) {
  return group.name || `Group ${String(group.sgid)}`
}

function getGroupTypeValue(group: ServerGroupRow) {
  return Number(group.type)
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

function createGroupedOptions(groups: ServerGroupRow[]): AppSelectGroup[] {
  return [1, 0, 2]
    .map((type) => ({
      label: getGroupSectionLabel(type),
      options: groups
        .filter((group) => getGroupTypeValue(group) === type)
        .map((group) => ({
          label: `${getGroupName(group)} (${String(group.sgid)})`,
          value: String(group.sgid),
        })),
    }))
    .filter((group) => group.options.length > 0)
}

export function ServerGroups() {
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const queryUserRef = useRef(queryUser)
  const selectServerFlightRef = useRef<ReturnType<
    typeof TeamSpeak.useServer
  > | null>(null)
  const loadGroupsFlightRef = useRef<Promise<void> | null>(null)
  const { dismissToast, showError, showSuccess, toasts } = useToastStack()
  const [groups, setGroups] = useState<ServerGroupRow[]>([])
  const [clients, setClients] = useState<ClientDbRow[]>([])
  const [editMembers, setEditMembers] = useState<GroupMemberRow[]>([])
  const [initialEditMembers, setInitialEditMembers] = useState<GroupMemberRow[]>(
    [],
  )
  const [groupToEdit, setGroupToEdit] = useState<ServerGroupRow | null>(null)
  const [groupToCopy, setGroupToCopy] = useState<ServerGroupRow | null>(null)
  const [groupToDelete, setGroupToDelete] = useState<ServerGroupRow | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [copyDialogOpen, setCopyDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [createForm, setCreateForm] = useState<CreateServerGroupForm>({
    name: "",
    type: "1",
  })
  const [editForm, setEditForm] = useState<EditServerGroupForm>({ name: "" })
  const [copyForm, setCopyForm] = useState<CopyServerGroupForm>({
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
    () => groups.find((group) => String(group.sgid) === copyForm.targetGroupId),
    [copyForm.targetGroupId, groups],
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

  const sortedGroups = useMemo(
    () =>
      [...groups].sort((firstGroup, secondGroup) => {
        const order = [1, 0, 2]
        const firstTypeIndex = order.indexOf(getGroupTypeValue(firstGroup))
        const secondTypeIndex = order.indexOf(getGroupTypeValue(secondGroup))
        const firstGroupRank = firstTypeIndex === -1 ? order.length : firstTypeIndex
        const secondGroupRank = secondTypeIndex === -1 ? order.length : secondTypeIndex
        const typeDiff = firstGroupRank - secondGroupRank

        if (typeDiff !== 0) {
          return typeDiff
        }

        return getNumberValue(firstGroup.sgid) - getNumberValue(secondGroup.sgid)
      }),
    [groups],
  )

  const visibleGroups = sortedGroups



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
            const groupList = await TeamSpeak.execute<ServerGroupRow[]>(
              "servergrouplist",
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

  const openEditDialog = async (group: ServerGroupRow) => {
    setGroupToEdit(group)
    setEditForm({ name: getGroupName(group) })
    setEditMembers([])
    setInitialEditMembers([])
    setMemberFilter("")
    setAvailableClientFilter("")
    setEditDialogOpen(true)
    setEditLoading(true)

    try {
      await ensureSelectedServer()
      const [clientList, groupMembers] = await Promise.all([
        fullClientDBList(),
        TeamSpeak.execute<GroupMemberRow[]>("servergroupclientlist", {
          sgid: group.sgid,
        }).catch((error: unknown) => {
          if (isDatabaseEmptyResult(error)) return []
          throw error
        }),
      ])

      setClients(clientList)
      setEditMembers(Array.isArray(groupMembers) ? groupMembers : [])
      setInitialEditMembers(Array.isArray(groupMembers) ? groupMembers : [])
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
    setEditForm({ name: "" })
    setEditMembers([])
    setInitialEditMembers([])
  }

  const openCopyDialog = (group: ServerGroupRow) => {
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

  const openDeleteDialog = (group: ServerGroupRow) => {
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
      await TeamSpeak.execute("servergroupadd", {
        name,
        type: Number(createForm.type),
      })

      showSuccess("Server group created")
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

      if (name !== getGroupName(groupToEdit)) {
        await TeamSpeak.execute("servergrouprename", {
          name,
          sgid: groupToEdit.sgid,
        })
      }

      const nextMemberIds = new Set(editMembers.map((member) => String(member.cldbid)))
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
        await TeamSpeak.execute("servergroupdelclient", {
          cldbid: member.cldbid,
          sgid: groupToEdit.sgid,
        })
      }

      for (const member of membersToAdd) {
        await TeamSpeak.execute("servergroupaddclient", {
          cldbid: member.cldbid,
          sgid: groupToEdit.sgid,
        })
      }

      showSuccess("Server group updated")
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
      await TeamSpeak.execute("servergroupcopy", {
        name,
        ssgid: groupToCopy.sgid,
        tsgid: copyForm.overwrite && selectedTargetGroup ? selectedTargetGroup.sgid : 0,
        type: Number(copyForm.targetGroupType),
      })

      showSuccess("Server group copied")
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
      await TeamSpeak.execute("servergroupdel", {
        force: forceDeletion ? 1 : 0,
        sgid: groupToDelete.sgid,
      })

      showSuccess("Server group deleted")
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
              Add Server Group
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
              visibleGroups.map((group, index) => {
                const previousGroup = visibleGroups[index - 1]
                const showSection =
                  !previousGroup ||
                  getGroupTypeValue(previousGroup) !== getGroupTypeValue(group)

                return (
                  <Fragment key={String(group.sgid)}>
                    {showSection ? (
                      <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:pt-0">
                        {getGroupSectionLabel(group.type)}
                      </div>
                    ) : null}
                    <div className="space-y-3 rounded-md border p-3 text-sm">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div
                          className="min-w-0 flex-1 truncate font-medium"
                          title={getGroupName(group)}
                        >
                          {getGroupName(group)}
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
                                Open server group actions
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
                            {group.sgid}
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
                No server groups found.
              </div>
            )}
          </div>
          <div className="hidden max-w-full overflow-x-auto px-3 pb-2 sm:px-6 md:block">
            <Table className="w-full min-w-[620px]">
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
                  visibleGroups.map((group, index) => {
                    const previousGroup = visibleGroups[index - 1]
                    const showSection =
                      !previousGroup ||
                      getGroupTypeValue(previousGroup) !== getGroupTypeValue(group)

                    return (
                      <Fragment key={String(group.sgid)}>
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
                                    Open server group actions
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
                            title={getGroupName(group)}
                          >
                            {getGroupName(group)}
                          </TableCell>
                          <TableCell>{group.sgid}</TableCell>
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
                      No server groups found.
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
            <Label htmlFor="server-group-name">Group Name</Label>
            <Input
              id="server-group-name"
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
        title="Edit Server Group"
        footer={
          <>
            <Button
              disabled={submitting || editLoading || !editForm.name.trim()}
              type="button"
              onClick={saveGroup}
            >
              {submitting ? "Saving..." : "Save"}
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
            <Label htmlFor="edit-server-group-name">Name</Label>
            <Input
              id="edit-server-group-name"
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

          <div className="min-w-0 max-w-full overflow-hidden rounded-md border p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium pb-3">Members</div>
              </div>
            </div>

            {editLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                ...loading
              </div>
            ) : groupToEdit && getGroupTypeValue(groupToEdit) !== 1 ? (
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">
                  Member editing is disabled for this group type.
                </div>
                <div className="max-h-64 min-w-0 max-w-full space-y-1 overflow-y-auto rounded-md border border-dashed p-2">
                  {memberClients.length ? (
                    memberClients.map((client) => (
                      <label
                        className="flex min-w-0 cursor-not-allowed items-start gap-2 rounded px-2 py-1.5 text-sm opacity-60"
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
                  <Label htmlFor="server-group-member-filter">Current members</Label>
                  <Input
                    className="min-w-0"
                    id="server-group-member-filter"
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
                  <Label htmlFor="server-group-available-filter">Available clients</Label>
                  <Input
                    className="min-w-0"
                    id="server-group-available-filter"
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
              value={groupToCopy ? `${getGroupName(groupToCopy)} (${groupToCopy.sgid})` : ""}
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
                    targetGroupName: overwrite && nextTarget
                      ? getGroupName(nextTarget)
                      : currentForm.targetGroupName,
                    targetGroupType: overwrite && nextTarget
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
                  (currentGroup) => String(currentGroup.sgid) === value,
                )
                setCopyForm((currentForm) => ({
                  ...currentForm,
                  targetGroupId: value,
                  targetGroupName: group ? getGroupName(group) : currentForm.targetGroupName,
                  targetGroupType: group ? String(group.type) : currentForm.targetGroupType,
                }))
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="copy-target-name">Target Group Name</Label>
            <Input
              id="copy-target-name"
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
              {groupToDelete ? getGroupName(groupToDelete) : ""}
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
