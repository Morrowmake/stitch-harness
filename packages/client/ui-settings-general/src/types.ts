/** Type-only Electron update-check declarations shared by the settings UI and the Desktop preload. */

/** Outcome of one explicit check; the release page itself is opened by the shell, never by the page. */
export type DesktopUpdateCheckResult =
  | { readonly kind: 'available'; readonly version: string; readonly name: string }
  | { readonly kind: 'current'; readonly version: string }
  | { readonly kind: 'failed' }

/** Optional isolated preload API, absent in ordinary browsers. */
export interface DesktopUpdateBridge {
  /** @returns The persisted automatic-check preference; on unless the user turned it off. */
  getPreference(): Promise<boolean>
  /**
   * @param enabled - Explicit user choice to persist; enabling triggers an immediate check.
   * @returns The persisted value; rejects when it could not be saved.
   */
  setPreference(enabled: boolean): Promise<boolean>
  /**
   * @param listener - Receives preference changes made from any Desktop window.
   * @returns Removes this window's subscription.
   */
  subscribe(listener: (enabled: boolean) => void): () => void
  /** @returns The result of one check made now, regardless of the preference. */
  check(): Promise<DesktopUpdateCheckResult>
}
