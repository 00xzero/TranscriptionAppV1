const titleInputId = 'capture-title-input'
const languageSelectId = 'capture-language-select'

interface CaptureDetailsProps {
  title: string
  setTitle: (value: string) => void
  isUploading: boolean
}

export default function CaptureDetails({ title, setTitle, isUploading }: CaptureDetailsProps) {
  return (
    <div className="space-y-4 pt-2 border-t border-[#D1CEC5] dark:border-white/10">
      <label className="block text-[10px] font-mono uppercase tracking-wider opacity-60 mt-4">Project Details</label>

      <div className="space-y-1">
        <label className="text-xs font-medium opacity-80" htmlFor={titleInputId}>Title</label>
        <input
          id={titleInputId}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Client Interview - January 2026"
          disabled={isUploading}
          className="w-full bg-white/50 dark:bg-[#222]/50 border border-[#D1CEC5] dark:border-[#444] rounded px-3 py-2 text-sm focus:outline-none focus:border-trust-blue focus:bg-white dark:focus:bg-[#222] transition-colors placeholder-ink/30 dark:placeholder-white/20 disabled:opacity-50"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium opacity-80" htmlFor={languageSelectId}>
          Language <span className="text-[10px] font-mono opacity-50 ml-1">(coming soon)</span>
        </label>
        <div className="relative">
          <select
            id={languageSelectId}
            className="w-full bg-white/50 dark:bg-[#222]/50 border border-[#D1CEC5] dark:border-[#444] rounded px-3 py-2 text-sm transition-colors appearance-none cursor-not-allowed opacity-60"
            disabled
          >
            <option>English (US)</option>
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div>
          <p className="text-xs font-medium opacity-80">
            Speaker Diarization <span className="text-[10px] font-mono opacity-50">(coming soon)</span>
          </p>
          <p className="text-[10px] text-ink/40 dark:text-white/40">Automatically identify speakers</p>
        </div>
        <div className="relative inline-block w-10 mr-2 align-middle select-none opacity-50 cursor-not-allowed">
          <div className="block overflow-hidden h-5 rounded-full bg-ember-red">
            <div className="absolute block w-5 h-5 rounded-full bg-white border-4 border-ember-red right-0" />
          </div>
        </div>
      </div>
    </div>
  )
}
