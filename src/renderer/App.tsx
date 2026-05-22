import { useEffect, useState } from 'react'
import Sidebar from './chrome/Sidebar'
import Welcome from './screens/Welcome'
import Workspace from './screens/Workspace'
import OnboardingOverlay from './panels/OnboardingOverlay/OnboardingOverlay'
import DaemonSettingsModal from './panels/DaemonPanel/DaemonSettingsModal'
import DaemonQueueModal from './panels/DaemonPanel/DaemonQueueModal'
import DaemonQuestionsModal from './panels/DaemonPanel/DaemonQuestionsModal'
import { useProjectStore } from './state/projectStore'
import { usePreviewStore } from './state/previewStore'
import { useChatStore } from './state/chatStore'
import { useActivityStore } from './state/activityStore'
import { useEditorStore } from './state/editorStore'
import { useDaemonStore } from './state/daemonStore'

export default function App() {
  const { loadProjects, activeProjectId } = useProjectStore()
  const [showOnboarding, setShowOnboarding] = useState(false)
  const { modalOpen, closeModal } = useDaemonStore()

  // ── Bootstrap ──────────────────────────────────────────────────────────
  useEffect(() => {
    loadProjects()
    window.api.onboardingIsDone().then((done) => {
      if (!done) setShowOnboarding(true)
    })
  }, [])

  // ── Daemon status polling ──────────────────────────────────────────────
  useEffect(() => {
    const { refreshStatus, refreshQuestionCounts } = useDaemonStore.getState()
    refreshStatus()
    refreshQuestionCounts()
    const statusTimer = setInterval(refreshStatus, 5000)
    const questionTimer = setInterval(refreshQuestionCounts, 30000)
    return () => {
      clearInterval(statusTimer)
      clearInterval(questionTimer)
    }
  }, [])

  function handleOnboardingDismiss() {
    setShowOnboarding(false)
    window.api.onboardingComplete()
  }

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

      // Auto-restart preview when Claude signals setup is complete
      const { awaitingSetupComplete, setAwaitingSetupComplete, setSettingUp } =
        usePreviewStore.getState()
      if (awaitingSetupComplete && message.role === 'assistant' && message.text.includes('SETUP_COMPLETE')) {
        setAwaitingSetupComplete(false)
        setSettingUp(false)
        const { activeProjectId, projects } = useProjectStore.getState()
        const project = projects.find((p) => p.id === activeProjectId)
        if (activeProjectId && project) {
          window.api.previewRestart(activeProjectId, project.path)
        }
      }
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

  // ── Agent event push channel ───────────────────────────────────────────
  useEffect(() => {
    return window.api.agentOnEvent((event) => {
      useActivityStore.getState().appendEvent(event)
    })
  }, [])

  // ── File watcher push channel ──────────────────────────────────────────
  useEffect(() => {
    return window.api.fsOnFileChanged((event) => {
      useEditorStore.getState().handleExternalChange(event.projectId, event.relativePath)
    })
  }, [])

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
      {showOnboarding && <OnboardingOverlay onDismiss={handleOnboardingDismiss} />}
      {modalOpen === 'settings' && <DaemonSettingsModal onClose={closeModal} />}
      {modalOpen === 'queue' && <DaemonQueueModal onClose={closeModal} />}
      {modalOpen === 'questions' && <DaemonQuestionsModal onClose={closeModal} />}
      <Sidebar />
      <div className="flex flex-1 overflow-hidden">
        {activeProjectId ? <Workspace /> : <Welcome />}
      </div>
    </div>
  )
}
