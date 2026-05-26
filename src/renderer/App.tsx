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
import { useGitHubStore } from './state/githubStore'
import { useGitStatusStore } from './state/gitStatusStore'
import GoalsWizardModal from './panels/GoalsWizard/GoalsWizardModal'
import { loadSkills } from './skills'
import { useSettingsStore } from './state/settingsStore'
import { useAskSneeblyStore } from './panels/AskSneebly/useAskSneeblyStore'

export default function App() {
  const { loadProjects, activeProjectId } = useProjectStore()
  const [showOnboarding, setShowOnboarding] = useState(false)
  const { modalOpen, closeModal } = useDaemonStore()

  // ── Bootstrap ──────────────────────────────────────────────────────────
  useEffect(() => {
    // If this window was opened for a specific project (via "Open in new window"),
    // activate that project instead of the most-recently-opened one.
    const params = new URLSearchParams(window.location.search)
    const initialProjectId = params.get('projectId') ?? undefined
    loadProjects(initialProjectId)
    window.api.onboardingIsDone().then((done) => {
      if (!done) setShowOnboarding(true)
    })
    loadSkills().catch(console.error)
    useSettingsStore.getState().load().catch(console.error)
    window.api.settingsGet()
      .then((s) => useAskSneeblyStore.setState({ sidebarVisible: s.askSneeblySidebarVisible ?? false }))
      .catch(() => {})
  }, [])

  // ── GitHub auth status check ───────────────────────────────────────────
  useEffect(() => {
    useGitHubStore.getState().checkStatus()
  }, [])

  // ── Git status polling ─────────────────────────────────────────────────
  useEffect(() => {
    const { refresh, reset } = useGitStatusStore.getState()
    if (!activeProjectId) { reset(); return }
    refresh()
    const timer = setInterval(refresh, 10000)
    return () => clearInterval(timer)
  }, [activeProjectId])

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

  // ── Chat in-flight push channel ────────────────────────────────────────
  useEffect(() => {
    return window.api.chatOnInFlightChanged((payload) => {
      useActivityStore.getState().setChatInFlight(payload.projectId, payload.inFlight)
    })
  }, [])

  // ── Ask Sneebly push channels ──────────────────────────────────────────
  useEffect(() => {
    const offChunk = window.api.askSneeblyOnChunk((turnId, chunk) =>
      useAskSneeblyStore.getState()._onChunk(turnId, chunk)
    )
    const offThinking = window.api.askSneeblyOnThinking((turnId, status) =>
      useAskSneeblyStore.getState()._onThinking(turnId, status)
    )
    const offDone = window.api.askSneeblyOnDone((turnId, error) =>
      useAskSneeblyStore.getState()._onDone(turnId, error)
    )
    return () => { offChunk(); offThinking(); offDone() }
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
      <GoalsWizardModal />
      <Sidebar />
      <div className="flex flex-1 overflow-hidden">
        {activeProjectId ? <Workspace /> : <Welcome />}
      </div>
    </div>
  )
}
