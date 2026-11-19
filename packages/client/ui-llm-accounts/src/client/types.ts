/** Inject faces of this plugin's slot entries. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { AccountsOperations } from './operations.ts'
import type { AccountsState } from './store.ts'

/** The `settings.models.provider-card` entry's face (one per page; the owner props name the card's route). */
export interface AccountsSectionInjected {
  hooks: { accounts: SnapshotStore<AccountsState> }
  /** Hold the usage subscription while the section is mounted; returns the release. */
  acquire: () => () => void
  operations: AccountsOperations
}

/** The `conversation.composer.dock` entry's face for one Session. */
export interface UsageBadgeInjected {
  hooks: {
    accounts: SnapshotStore<AccountsState>
    /** The Session's model selection; the badge follows its provider. */
    selection: SnapshotStore<ModelDirectoryState>
  }
  /** Hold the usage subscription while the badge is mounted and the document is visible; returns the release. */
  acquire: () => () => void
  operations: AccountsOperations
}
