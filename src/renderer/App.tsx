import { useEffect } from 'react'
import Sidebar from './chrome/Sidebar'
import Welcome from './screens/Welcome'
import Workspace from './screens/Workspace'
import { useProjectStore } from './state/projectStore'
import { usePreviewStore } from './state/previewStore'
import { useChatStore } from './state/chatStore'

export default function App() {
  const { loadProjects, activeProjectId } = useProjectStore()

  // ── Bootstrap ──────────────────────────────────────────────────────────
  useEffect(() => { loadProjects() }, [])

  // ── Preview status push channel ────────────────────────────────────────
  useEffect(() => {
    return window.api.previewOnStatus((event) => {
      const id = useProjectStore.getState().activeProjectId
      usePreviewStore.getState().handleStatusEvent(event, id)
    })
  }, [])

  // ── Chat push channel ──────────────────────────────────────────────────
  useEffect(() => {
    return window.api.chatOnMessageAppended((sessionId, message) => {
      useChatStore.getState().appendIncomingMessage(sessionId, message)
    })
  }, [])

  // ── Dev server lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    if (!activeProjectId) return
    const { projects } = useProjectStore.getState()
    const project = projects.find((p) => p.id === activeProjectId)
    if (!project) return

    usePreviewStore.getState().reset()
    window.api.previewStart(activeProjectId, project.path)

    return () => { window.api.previewStop(activeProjectId) }
  }, [activeProjectId])

  // ── Session lifecycle ──────────────────────────────────────────────────
  useEffect(() => {
    if (!activeProjectId) {
      useChatStore.getState().reset()
      return
    }
    const { projects } = useProjectStore.getState()
    const project = projects.find((p) => p.id === activeProjectId)
    if (!project) return

    useChatStore.getState().loadForProject(project.path, project.id)
  }, [activeProjectId])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950">
      <Sidebar />
      <div className="flex flex-1 overflow-hidden">
        {activeProjectId ? <Workspace /> : <Welcome />}
      </div>
    </div>
  )
}
