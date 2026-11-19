/** The opt-in update-check preference over the shared shell settings document. */
import { appendFileSync } from 'node:fs'
import { DesktopSettingsFile, DesktopSettingsFileError } from './settings-file.ts'

/** No file watching; loading and explicit UI saves share shell storage and validation. */
export class DesktopUpdateSettings {
  private readonly file: DesktopSettingsFile
  readonly path: string

  /** @param userData - Electron userData, independent of Host and DSH_HOME. */
  constructor(userData: string) {
    this.file = new DesktopSettingsFile(userData)
    this.path = this.file.path
  }

  /**
   * @returns Whether update checks are enabled; a missing, unreadable, or invalid setting means off,
   * so no request is made unless the user explicitly turned checks on.
   */
  async load(): Promise<boolean> {
    const result = await this.file.read()
    if (result.kind === 'error') {
      console.warn('desktop settings: update preference unavailable', result.error.message)
      return false
    }
    if (result.kind === 'missing') return false
    const field = result.fields.checkForUpdates
    if (field.kind === 'invalid') console.warn('desktop settings: invalid update preference', field.error.message)
    return field.kind === 'valid' && field.value
  }

  /**
   * Save the preference while preserving other fields.
   * @param checkForUpdates - Explicit user choice.
   * @returns After a confirmed write, including logged lock-release failures.
   * Uncertain writes reject without retry; diagnostics are appended to settings.json.save.jsonl.
   */
  async save(checkForUpdates: boolean): Promise<void> {
    try { await this.file.saveUpdates({ checkForUpdates }) } catch (error) {
      if (!(error instanceof DesktopSettingsFileError) || error.problem.kind !== 'write') throw error
      const entry = { time: new Date().toISOString(), event: 'settings-save-failed', effect: error.problem.effect,
        path: this.path, reason: error.cause instanceof Error ? error.cause.message : String(error.cause) }
      try { appendFileSync(`${this.path}.save.jsonl`, `${JSON.stringify(entry)}\n`, { mode: 0o600, flush: true }) } catch (logError) {
        console.error('desktop settings: could not persist save warning', entry, logError)
      }
      if (error.problem.effect !== 'written') throw error
    }
  }
}
