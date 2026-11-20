/** The two on-demand entry points: Plugins page "Add plugin" menu and the Models page footer. */
import type { ReactNode } from 'react'
import { Button, IconLayersOutlineRegular, IconPlusOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { NS } from './locales.ts'
import type { FirstRunEntryInjected } from './types.ts'
import css from './first-run.module.css'

/** Props of the Plugins page menu item. */
export type ChooseComponentsMenuItemProps = PropsRuntime<'plugins.add.actions'> & PropsLocale<typeof NS> & InjectFace<FirstRunEntryInjected>

/**
 * Close the Add plugin menu and open the component picker.
 * @param props - copy, the menu dismissal, and the open callback.
 * @returns the menu item.
 */
export function ChooseComponentsMenuItem({ t, onDismiss, open }: ChooseComponentsMenuItemProps): ReactNode {
  return (
    <MenuItemButton icon={<IconLayersOutlineRegular size={14} />} onSelect={() => {
      onDismiss()
      open()
    }}>
      <span className={css.menuCopy}>
        <span>{t('entry.components')}</span>
        <span className={css.menuDescription} title={t('entry.componentsHint')}>{t('entry.componentsHint')}</span>
      </span>
    </MenuItemButton>
  )
}

/** Props of the Models page footer entry. */
export type SetUpProviderEntryProps = PropsRuntime<'settings.models.footer'> & PropsLocale<typeof NS> & InjectFace<FirstRunEntryInjected>

/**
 * Open the provider picker from Settings → Models.
 * @param props - copy and the open callback.
 * @returns the footer row.
 */
export function SetUpProviderEntry({ t, open }: SetUpProviderEntryProps): ReactNode {
  return (
    <div className={css.footerEntry}>
      <Button variant="primary" icon={<IconPlusOutlineRegular size={14} />} onClick={open}>{t('entry.provider')}</Button>
      <span className={css.hint}>{t('entry.providerHint')}</span>
    </div>
  )
}
