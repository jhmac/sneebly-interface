import { create } from 'zustand'

type ActivityTab = 'activity' | 'files'

interface ActivityPanelState {
  activeTab: ActivityTab
  setActiveTab: (tab: ActivityTab) => void
}

function loadTab(): ActivityTab {
  try {
    const stored = localStorage.getItem('activityPanel.activeTab')
    if (stored === 'files' || stored === 'activity') return stored
  } catch { /* ignore */ }
  return 'activity'
}

export const useActivityPanelStore = create<ActivityPanelState>((set) => ({
  activeTab: loadTab(),
  setActiveTab: (tab) => {
    try { localStorage.setItem('activityPanel.activeTab', tab) } catch { /* ignore */ }
    set({ activeTab: tab })
  },
}))
