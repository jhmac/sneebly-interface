import { useActivityStore } from '../../state/activityStore'
import type { CardType } from '../../../shared/types'

const PILL_LABELS: Record<CardType, string> = {
  thinking: 'Think', read: 'Read', edit: 'Edit', write: 'Write', bash: 'Bash',
  search: 'Search', webfetch: 'Fetch', task: 'Task', permission: 'Perm',
  error: 'Error', summary: 'Summary', browsercheck: 'Browser',
}

export default function FilterBar() {
  const { filters, toggleFilter, sourceFilters, toggleSourceFilter } = useActivityStore()
  return (
    <div className="flex flex-shrink-0 flex-wrap gap-1 border-b border-zinc-800 bg-zinc-950 px-3 py-1.5">
      {/* Source filters — Chat and Daemon first */}
      <button
        onClick={() => toggleSourceFilter('chat')}
        className={[
          'rounded px-2 py-0.5 text-[10px] transition-colors',
          sourceFilters.chat
            ? 'bg-zinc-700 text-zinc-300'
            : 'bg-zinc-900 text-zinc-600 line-through hover:bg-zinc-800',
        ].join(' ')}
      >
        Chat
      </button>
      <button
        onClick={() => toggleSourceFilter('daemon')}
        className={[
          'rounded px-2 py-0.5 text-[10px] transition-colors',
          sourceFilters.daemon
            ? 'bg-indigo-800 text-indigo-200'
            : 'bg-zinc-900 text-zinc-600 line-through hover:bg-zinc-800',
        ].join(' ')}
      >
        Daemon
      </button>
      <button
        onClick={() => toggleSourceFilter('spec-generator')}
        className={[
          'rounded px-2 py-0.5 text-[10px] transition-colors',
          sourceFilters['spec-generator']
            ? 'bg-purple-800 text-purple-200'
            : 'bg-zinc-900 text-zinc-600 line-through hover:bg-zinc-800',
        ].join(' ')}
      >
        Spec
      </button>

      {/* Vertical separator */}
      <span className="self-stretch w-px bg-zinc-800 mx-0.5" />

      {/* Card type filters */}
      {(Object.keys(PILL_LABELS) as CardType[]).map((type) => (
        <button
          key={type}
          onClick={() => toggleFilter(type)}
          className={[
            'rounded px-2 py-0.5 text-[10px] transition-colors',
            filters[type]
              ? 'bg-zinc-700 text-zinc-300'
              : 'bg-zinc-900 text-zinc-600 line-through hover:bg-zinc-800',
          ].join(' ')}
        >
          {PILL_LABELS[type]}
        </button>
      ))}
    </div>
  )
}
