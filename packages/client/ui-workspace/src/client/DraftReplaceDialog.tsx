/** "Replace the current draft?" confirmation for a prepared request that meets the user's own text. */
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DraftReplaceProps } from './contract/slots.ts'

/**
 * The `shell.overlay` entry: nothing while no question is pending, otherwise
 * one dialog. Replace swaps the draft text for the request; Keep my text,
 * closing, and Escape keep the user's text and drop the request.
 * @param props - the question hook, its answer, and the locale seat.
 * @returns the open dialog, or null.
 */
export function DraftReplaceDialog({ useDraftReplaceRequest, settleDraftReplace, t }: DraftReplaceProps) {
  const request = useDraftReplaceRequest(pending => pending)
  if (request === null) return null
  const keep = () => { settleDraftReplace(false) }
  return (
    <Modal
      open
      onClose={keep}
      closeLabel={t('close')}
      title={t('draft.replace.title')}
      description={t('draft.replace.desc')}
      footer={(
        <>
          <Button variant="outline" data-modal-autofocus onClick={keep}>{t('draft.replace.keep')}</Button>
          <Button variant="primary" onClick={() => { settleDraftReplace(true) }}>{t('draft.replace.confirm')}</Button>
        </>
      )}
    />
  )
}
