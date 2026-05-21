import { useEffect } from 'react'
import Sidebar from './chrome/Sidebar'
import Welcome from './screens/Welcome'
import Workspace from './screens/Workspace'
import { useProjectStore } from './state/projectStore'
import { usePreviewStore } from './state/previewStore'

export default function App() {
  const { loadProjects, activeProjectId } = useProjectStore()

  useEffect(() => {
    loadProjects()
  }, [])

  // Subscribe to preview status events from main once, globally
  useEffect(() => {
    const unsub = window.api.previewOnStatus((event) => {
      const id = useProjectStore.getState().activeProjectId
      usePreviewStore.getState().handleStatusEvent(event, id)
    })
    return unsub
  }, [])

  // Start/stop dev server when active project changes
  useEffect(() => {
    if (!activeProjectId) return

    const { projects } = useProjectStore.getState()
    const project = projects.find((p) => p.id === activeProjectId)
    if (!project) return

    usePreviewStore.getState().reset()
    window.api.previewStart(activeProjectId, project.path)

    return () => {
      window.api.previewStop(activeProjectId)
    }
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
