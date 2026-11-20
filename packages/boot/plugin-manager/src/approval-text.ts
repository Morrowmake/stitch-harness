/** Plain-language approval prompts for `plugin_manager` changes, in every UI locale. */
import { basename } from 'node:path'
import type { LocalizedText } from '@deepseek-ai/dsh-package-manifest'
import { InvalidInstallSpecError, parseInstallSpec, type ParsedInstallSpec } from './install-spec.ts'

/** Where an installation comes from, as the prompt names it. */
type InstallSource = { kind: 'folder' } | { kind: 'registry' } | { kind: 'host'; host: string } | { kind: 'unknown' }

/** One profile change awaiting approval, with the display name of what it changes. */
export type ManagementChange =
  | { kind: 'install'; name: string; source: InstallSource; enabled: boolean; builds: readonly string[] }
  | { kind: 'enable' | 'disable' | 'remove'; name: LocalizedText }
  | { kind: 'exempt' | 'unexempt'; name: string; runtimeVersion: string }

const en = {
  sourceFolder: 'from a folder on this computer',
  sourceRegistry: 'from the npm registry',
  sourceHost: (host: string) => `from ${host}`,
  install: (name: string, source: string) => `Install the plugin “${name}” ${source} into this profile.`,
  installUnknown: (name: string) => `Install the plugin “${name}” into this profile.`,
  fullAccess: 'It will run with full access to your computer.',
  installDisabled: 'It stays turned off until you turn it on.',
  buildScripts: (names: string) => `Its setup scripts will also run: ${names}.`,
  enable: (name: string) => `Turn on the plugin “${name}” in this profile.`,
  disable: (name: string) => `Turn off the plugin “${name}” in this profile.`,
  remove: (name: string) => `Remove the plugin “${name}” from this profile.`,
  exempt: (name: string, version: string) => `Let “${name}” run on Stitch ${version} although it does not declare support for that version. It may crash or lose data.`,
  unexempt: (name: string, version: string) => `Stop letting “${name}” run on Stitch ${version} without declared support.`,
  everyChat: 'The change applies to every chat in this profile.',
}

const zh = {
  sourceFolder: '从这台电脑上的文件夹',
  sourceRegistry: '从 npm 软件源',
  sourceHost: (host: string) => `从 ${host} `,
  install: (name: string, source: string) => `${source}安装插件“${name}”到当前 profile。`,
  installUnknown: (name: string) => `安装插件“${name}”到当前 profile。`,
  fullAccess: '它将拥有对这台电脑的完全访问权限。',
  installDisabled: '安装后保持关闭，直到你手动开启。',
  buildScripts: (names: string) => `还会运行它的安装脚本：${names}。`,
  enable: (name: string) => `在当前 profile 中开启插件“${name}”。`,
  disable: (name: string) => `在当前 profile 中关闭插件“${name}”。`,
  remove: (name: string) => `从当前 profile 中移除插件“${name}”。`,
  exempt: (name: string, version: string) => `允许“${name}”在 Stitch ${version} 上运行，尽管它未声明支持该版本。这可能导致崩溃或数据丢失。`,
  unexempt: (name: string, version: string) => `不再允许“${name}”在未声明支持的 Stitch ${version} 上运行。`,
  everyChat: '此更改对当前 profile 中的所有对话生效。',
} satisfies typeof en

const ja = {
  sourceFolder: 'このコンピューター上のフォルダーから',
  sourceRegistry: 'npm レジストリから',
  sourceHost: (host: string) => `${host} から`,
  install: (name: string, source: string) => `プラグイン「${name}」を${source}このプロファイルにインストールします。`,
  installUnknown: (name: string) => `プラグイン「${name}」をこのプロファイルにインストールします。`,
  fullAccess: 'このプラグインはコンピューターへのフルアクセス権で動作します。',
  installDisabled: 'オンにするまでオフのままです。',
  buildScripts: (names: string) => `セットアップスクリプトも実行されます：${names}。`,
  enable: (name: string) => `このプロファイルでプラグイン「${name}」をオンにします。`,
  disable: (name: string) => `このプロファイルでプラグイン「${name}」をオフにします。`,
  remove: (name: string) => `このプロファイルからプラグイン「${name}」を削除します。`,
  exempt: (name: string, version: string) => `「${name}」は Stitch ${version} への対応を宣言していませんが、実行を許可します。クラッシュやデータ損失の恐れがあります。`,
  unexempt: (name: string, version: string) => `対応を宣言していない Stitch ${version} での「${name}」の実行許可を取り消します。`,
  everyChat: 'この変更はこのプロファイルのすべてのチャットに適用されます。',
} satisfies typeof en

const es = {
  sourceFolder: 'desde una carpeta de este equipo',
  sourceRegistry: 'desde el registro de npm',
  sourceHost: (host: string) => `desde ${host}`,
  install: (name: string, source: string) => `Instalar el complemento «${name}» ${source} en este perfil.`,
  installUnknown: (name: string) => `Instalar el complemento «${name}» en este perfil.`,
  fullAccess: 'Se ejecutará con acceso completo a tu equipo.',
  installDisabled: 'Permanecerá desactivado hasta que lo actives.',
  buildScripts: (names: string) => `También se ejecutarán sus scripts de instalación: ${names}.`,
  enable: (name: string) => `Activar el complemento «${name}» en este perfil.`,
  disable: (name: string) => `Desactivar el complemento «${name}» en este perfil.`,
  remove: (name: string) => `Quitar el complemento «${name}» de este perfil.`,
  exempt: (name: string, version: string) => `Permitir que «${name}» se ejecute en Stitch ${version} aunque no declara compatibilidad con esa versión. Puede fallar o perder datos.`,
  unexempt: (name: string, version: string) => `Dejar de permitir que «${name}» se ejecute en Stitch ${version} sin compatibilidad declarada.`,
  everyChat: 'El cambio se aplica a todos los chats de este perfil.',
} satisfies typeof en

const fr = {
  sourceFolder: 'depuis un dossier de cet ordinateur',
  sourceRegistry: 'depuis le registre npm',
  sourceHost: (host: string) => `depuis ${host}`,
  install: (name: string, source: string) => `Installer le plugin « ${name} » ${source} dans ce profil.`,
  installUnknown: (name: string) => `Installer le plugin « ${name} » dans ce profil.`,
  fullAccess: 'Il s’exécutera avec un accès complet à votre ordinateur.',
  installDisabled: 'Il reste désactivé jusqu’à ce que vous l’activiez.',
  buildScripts: (names: string) => `Ses scripts d’installation s’exécuteront aussi : ${names}.`,
  enable: (name: string) => `Activer le plugin « ${name} » dans ce profil.`,
  disable: (name: string) => `Désactiver le plugin « ${name} » dans ce profil.`,
  remove: (name: string) => `Supprimer le plugin « ${name} » de ce profil.`,
  exempt: (name: string, version: string) => `Autoriser « ${name} » à s’exécuter sur Stitch ${version} bien qu’il ne déclare pas prendre en charge cette version. Il peut planter ou perdre des données.`,
  unexempt: (name: string, version: string) => `Ne plus autoriser « ${name} » à s’exécuter sur Stitch ${version} sans prise en charge déclarée.`,
  everyChat: 'La modification s’applique à toutes les discussions de ce profil.',
} satisfies typeof en

const de = {
  sourceFolder: 'aus einem Ordner auf diesem Computer',
  sourceRegistry: 'aus der npm-Registry',
  sourceHost: (host: string) => `von ${host}`,
  install: (name: string, source: string) => `Das Plugin „${name}“ ${source} in dieses Profil installieren.`,
  installUnknown: (name: string) => `Das Plugin „${name}“ in dieses Profil installieren.`,
  fullAccess: 'Es läuft mit vollem Zugriff auf Ihren Computer.',
  installDisabled: 'Es bleibt ausgeschaltet, bis Sie es einschalten.',
  buildScripts: (names: string) => `Seine Einrichtungsskripte werden ebenfalls ausgeführt: ${names}.`,
  enable: (name: string) => `Das Plugin „${name}“ in diesem Profil einschalten.`,
  disable: (name: string) => `Das Plugin „${name}“ in diesem Profil ausschalten.`,
  remove: (name: string) => `Das Plugin „${name}“ aus diesem Profil entfernen.`,
  exempt: (name: string, version: string) => `„${name}“ auf Stitch ${version} ausführen lassen, obwohl es diese Version nicht als unterstützt angibt. Es kann abstürzen oder Daten verlieren.`,
  unexempt: (name: string, version: string) => `„${name}“ nicht mehr ohne angegebene Unterstützung auf Stitch ${version} ausführen lassen.`,
  everyChat: 'Die Änderung gilt für alle Chats in diesem Profil.',
} satisfies typeof en

const ru = {
  sourceFolder: 'из папки на этом компьютере',
  sourceRegistry: 'из реестра npm',
  sourceHost: (host: string) => `с ${host}`,
  install: (name: string, source: string) => `Установить плагин «${name}» ${source} в этот профиль.`,
  installUnknown: (name: string) => `Установить плагин «${name}» в этот профиль.`,
  fullAccess: 'Он будет работать с полным доступом к вашему компьютеру.',
  installDisabled: 'Он останется выключенным, пока вы его не включите.',
  buildScripts: (names: string) => `Также будут запущены его скрипты установки: ${names}.`,
  enable: (name: string) => `Включить плагин «${name}» в этом профиле.`,
  disable: (name: string) => `Выключить плагин «${name}» в этом профиле.`,
  remove: (name: string) => `Удалить плагин «${name}» из этого профиля.`,
  exempt: (name: string, version: string) => `Разрешить «${name}» работать в Stitch ${version}, хотя он не заявляет поддержку этой версии. Возможны сбои и потеря данных.`,
  unexempt: (name: string, version: string) => `Больше не разрешать «${name}» работать в Stitch ${version} без заявленной поддержки.`,
  everyChat: 'Изменение действует во всех чатах этого профиля.',
} satisfies typeof en

const pt = {
  sourceFolder: 'de uma pasta deste computador',
  sourceRegistry: 'do registro npm',
  sourceHost: (host: string) => `de ${host}`,
  install: (name: string, source: string) => `Instalar o plugin “${name}” ${source} neste perfil.`,
  installUnknown: (name: string) => `Instalar o plugin “${name}” neste perfil.`,
  fullAccess: 'Ele será executado com acesso total ao seu computador.',
  installDisabled: 'Ele fica desativado até você ativá-lo.',
  buildScripts: (names: string) => `Os scripts de instalação dele também serão executados: ${names}.`,
  enable: (name: string) => `Ativar o plugin “${name}” neste perfil.`,
  disable: (name: string) => `Desativar o plugin “${name}” neste perfil.`,
  remove: (name: string) => `Remover o plugin “${name}” deste perfil.`,
  exempt: (name: string, version: string) => `Permitir que “${name}” seja executado no Stitch ${version}, embora não declare suporte a essa versão. Ele pode travar ou perder dados.`,
  unexempt: (name: string, version: string) => `Deixar de permitir que “${name}” seja executado no Stitch ${version} sem suporte declarado.`,
  everyChat: 'A alteração se aplica a todos os chats deste perfil.',
} satisfies typeof en

const MESSAGES = { en, zh, ja, es, fr, de, ru, pt }

/** Every locale the approval text is written in. */
type ApprovalLocale = keyof typeof MESSAGES

/**
 * Read an install spec into the plugin name and source the prompt shows. A
 * spec the manager will reject keeps its raw text so the prompt still names it.
 * @param spec The `install_bundle` target.
 * @returns The display name and its source.
 */
export function installSubject(spec: string): { name: string; source: InstallSource } {
  let parsed: ParsedInstallSpec
  try { parsed = parseInstallSpec(spec) }
  catch (error) {
    if (!(error instanceof InvalidInstallSpecError)) throw error
    return { name: spec, source: { kind: 'unknown' } }
  }
  switch (parsed.kind) {
    case 'registry': return { name: parsed.name, source: { kind: 'registry' } }
    case 'path': return { name: basename(parsed.path), source: { kind: 'folder' } }
    case 'tarball': {
      const name = basename(parsed.path ?? URL.parse(spec)?.pathname ?? spec).replace(/\.(?:tgz|tar\.gz)$/i, '')
      return { name, source: parsed.host === undefined ? { kind: 'folder' } : { kind: 'host', host: parsed.host } }
    }
    case 'git': return { name: basename(spec.replace(/#.*$/s, '')).replace(/\.git$/i, ''), source: { kind: 'host', host: parsed.host } }
  }
}

function sentences(locale: ApprovalLocale, change: ManagementChange): string[] {
  const m = MESSAGES[locale]
  const localName = (name: LocalizedText): string => typeof name === 'string' ? name : name[locale] ?? name.en
  switch (change.kind) {
    case 'install': {
      const { source } = change
      const from = source.kind === 'folder' ? m.sourceFolder
        : source.kind === 'registry' ? m.sourceRegistry
          : source.kind === 'host' ? m.sourceHost(source.host) : undefined
      return [
        from === undefined ? m.installUnknown(change.name) : m.install(change.name, from),
        m.fullAccess,
        ...change.builds.length > 0 ? [m.buildScripts(change.builds.join(', '))] : [],
        ...change.enabled ? [] : [m.installDisabled],
      ]
    }
    case 'enable': return [m.enable(localName(change.name)), m.fullAccess]
    case 'disable': return [m.disable(localName(change.name))]
    case 'remove': return [m.remove(localName(change.name))]
    case 'exempt': return [m.exempt(change.name, change.runtimeVersion)]
    case 'unexempt': return [m.unexempt(change.name, change.runtimeVersion)]
  }
}

/**
 * Describe one profile change in plain language for the approval prompt; the
 * raw tool arguments stay available to the user beside it.
 * @param change The change awaiting approval.
 * @returns The description in every UI locale, ending with its profile-wide reach.
 */
export function managementApprovalText(change: ManagementChange): Record<ApprovalLocale, string> {
  const text = (locale: ApprovalLocale) => [...sentences(locale, change), MESSAGES[locale].everyChat]
    .join(locale === 'zh' || locale === 'ja' ? '' : ' ')
  return {
    en: text('en'), zh: text('zh'), ja: text('ja'), es: text('es'),
    fr: text('fr'), de: text('de'), ru: text('ru'), pt: text('pt'),
  }
}
