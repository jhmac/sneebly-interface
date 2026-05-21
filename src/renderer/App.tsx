import { useEffect } from 'react'
import Sidebar from './chrome/Sidebar'
import Welcome from './screens/Welcome'
import Workspace from './screens/Workspace'
import { useProjectStore } from './state/projectStore'

export default function App() {
  const { loadProjects, activeProjectId } = useProjectStore()

  useEffect(() => {
    loadProjects()
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950">
      <Sidebar />
      <div className="flex flex-1 overflow-hidden">
        {activeProjectId ? <Workspace /> : <Welcome />}
      </div>
    </div>
  )
}
