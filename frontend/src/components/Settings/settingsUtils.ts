import type { ConfiguredSource, IndexJobInfo, IndexJobStatus } from '../../types'

export const SOURCE_PRESETS = ['~/Documents', '~/Desktop', '~/Downloads', '~/Pictures', '~/Movies', '~/Music']

export function availablePresets(sources: ConfiguredSource[]): string[] {
  const addedNames = new Set(sources.map((s) => s.path.replace(/\/$/, '').split('/').pop()?.toLowerCase()))
  return SOURCE_PRESETS.filter((p) => !addedNames.has(p.replace('~/', '').toLowerCase()))
}

export function activeJobs(status?: IndexJobStatus | null): IndexJobInfo[] {
  if (!status) return []
  if (status.jobs) return status.jobs
  const jobs: IndexJobInfo[] = []
  if (status.is_running && status.current_path) {
    jobs.push({
      name: status.current_folder,
      path: status.current_path,
      state: 'running',
      percent: status.percent,
      current_index: status.current_index,
      total_files: status.total_files,
    })
  }
  for (const name of status.queued ?? []) {
    jobs.push({ name, path: '', state: 'queued', percent: 0, current_index: 0, total_files: 0 })
  }
  return jobs
}
