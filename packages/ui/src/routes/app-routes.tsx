import { Navigate, Route, Routes } from "react-router-dom"

import { ProtectedRoute } from "@/auth/protected-route"
import { AppLayout } from "@/layouts/app-layout"
import { ApiKeys } from "@/pages/api-keys"
import { Bans } from "@/pages/bans"
import { ChannelForm } from "@/pages/channel-form"
import { ChannelClientPermissions } from "@/pages/channel-client-permissions"
import { ChannelGroupPermissions } from "@/pages/channel-group-permissions"
import { ChannelGroups } from "@/pages/channel-groups"
import { ChannelPermissions } from "@/pages/channel-permissions"
import { Chat } from "@/pages/chat"
import { ClientBan } from "@/pages/client-ban"
import { ClientEdit } from "@/pages/client-edit"
import { ClientPermissions } from "@/pages/client-permissions"
import { Clients } from "@/pages/clients"
import { Complaints } from "@/pages/complaints"
import { Console } from "@/pages/console"
import { FileUpload } from "@/pages/file-upload"
import { Files } from "@/pages/files"
import { LoginPage } from "@/pages/login"
import { Logs } from "@/pages/logs"
import { LogoutPage } from "@/pages/logout"
import { NotFound } from "@/pages/not-found"
import { ServerViewerPage } from "@/pages/server-viewer"
import { ServerGroupPermissions } from "@/pages/server-group-permissions"
import { ServerGroups } from "@/pages/server-groups"
import { ServerCreate } from "@/pages/server-create"
import { ServerEdit } from "@/pages/server-edit"
import { ServersPage } from "@/pages/servers"
import { Snapshot } from "@/pages/snapshot"
import { SpacerAdd } from "@/pages/spacer-add"
import { Tokens } from "@/pages/tokens"
import { RouteProgress } from "@/components/route-progress"

export function AppRoutes() {
  return (
    <>
    <RouteProgress />
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/server/create" element={<ServerCreate />} />
          <Route path="/server/edit" element={<ServerEdit />} />
          <Route path="/serverviewer" element={<ServerViewerPage />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/chat/:cid" element={<Chat />} />
          <Route path="/files" element={<Files />} />
          <Route path="/file/upload/:cid" element={<FileUpload />} />
          <Route path="/snapshot" element={<Snapshot />} />
          <Route path="/console" element={<Console />} />
          <Route path="/tokens" element={<Tokens />} />
          <Route path="/apikeys" element={<ApiKeys />} />
          <Route path="/bans" element={<Bans />} />
          <Route path="/complaints" element={<Complaints />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/channel/add" element={<ChannelForm mode="add" />} />
          <Route path="/channel/:cid/edit" element={<ChannelForm mode="edit" />} />
          <Route path="/client/:cldbid/ban" element={<ClientBan />} />
          <Route path="/client/:clid/edit" element={<ClientEdit />} />
          <Route path="/servergroups" element={<ServerGroups />} />
          <Route path="/channelgroups" element={<ChannelGroups />} />
          <Route path="/spacer/add" element={<SpacerAdd />} />
          <Route path="/permissions/client" element={<ClientPermissions />} />
          <Route path="/permissions/client/:cldbid" element={<ClientPermissions />} />
          <Route path="/permissions/servergroup" element={<ServerGroupPermissions />} />
          <Route path="/permissions/servergroup/:sgid" element={<ServerGroupPermissions />} />
          <Route path="/permissions/channel" element={<ChannelPermissions />} />
          <Route path="/permissions/channel/:cid" element={<ChannelPermissions />} />
          <Route path="/permissions/channel/client" element={<ChannelClientPermissions />} />
          <Route path="/permissions/channel/:cid/client/:cldbid" element={<ChannelClientPermissions />} />
          <Route path="/permissions/channelgroup" element={<ChannelGroupPermissions />} />
          <Route path="/permissions/channelgroup/:cgid" element={<ChannelGroupPermissions />} />
          <Route path="/logout" element={<LogoutPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
    </>
  )
}
