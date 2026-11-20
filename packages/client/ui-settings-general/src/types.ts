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

/** Button the user pressed in the 'Terminal command' row. */
export type DesktopCommandAction = 'install' | 'repair' | 'remove'

/** Observed registration of the Desktop `stitch` terminal command. */
export type DesktopCommandStatus =
  /** This platform has no managed command; the row is hidden. */
  | { readonly kind: 'unsupported' }
  /** A development build or an app outside the Applications folder cannot register the command. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed' }
  | {
    readonly kind: 'installed' | 'notInstalled' | 'broken'
    /** Another `stitch` runs first in new terminals. */
    readonly shadowed: boolean
    /** The login shell could not be queried, so an alias may take precedence. */
    readonly selectionUnknown: boolean
  }

/** Optional isolated preload API for the terminal command, absent in ordinary browsers. */
export interface DesktopCommandBridge {
  /** @returns The current registration; never shows a dialog. */
  status(): Promise<DesktopCommandStatus>
  /**
   * Run one action through the shell's native confirmation and result dialogs.
   * @param action - Install when absent; Repair or Remove when registered.
   * @returns The registration observed after the dialogs close.
   */
  run(action: DesktopCommandAction): Promise<DesktopCommandStatus>
}
