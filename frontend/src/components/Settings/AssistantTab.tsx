import React from 'react'
import styles from './SettingsPage.module.css'

interface AssistantTabProps {
  draftInstructions: string
  savedInstructions: string
  saving: boolean
  onDraftChange: (text: string) => void
  onSave: () => void
}

export const AssistantTab: React.FC<AssistantTabProps> = ({
  draftInstructions,
  savedInstructions,
  saving,
  onDraftChange,
  onSave,
}) => (
  <div className={styles.panel}>
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderCol}>
          <h2 className={styles.cardTitle}>Custom instructions</h2>
          <p className={styles.cardSubtitle}>
            Added to every chat answer prompt with highest priority. Photo-only replies and
            live search suggestions are unaffected.
          </p>
        </div>
        <button
          className={`${styles.button} ${styles.primary}`}
          onClick={onSave}
          disabled={saving || draftInstructions === savedInstructions}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <textarea
        className={styles.promptBox}
        value={draftInstructions}
        maxLength={4000}
        rows={6}
        placeholder={'e.g. Always answer in under 3 sentences.\nCite file names with their full paths.'}
        onChange={(e) => onDraftChange(e.target.value)}
        aria-label="Custom assistant instructions"
      />
      <p className={styles.promptHint}>{draftInstructions.length}/4000</p>
    </div>
  </div>
)
