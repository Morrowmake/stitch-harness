/** Locale-owned sandbox approval text; audit inputs remain verbatim. */
import type { SandboxMode } from './index.ts'

/** English escalation messages. */
export const en = {
  access: {
    'read-only': 'read-only access',
    'workspace-write': 'permission to change files in your workspace',
    'danger-full-access': 'full access to your computer',
  } satisfies Record<SandboxMode, string>,
  escalation: (access: string, justification: string): string => `Allow this with ${access}? Reason given: ${justification}`,
}

/** Chinese escalation messages. */
export const zh = {
  access: {
    'read-only': '只读权限',
    'workspace-write': '修改工作区文件的权限',
    'danger-full-access': '对这台电脑的完全访问权限',
  },
  escalation: (access: string, justification: string): string => `是否允许以${access}执行此操作？给出的理由：${justification}`,
} satisfies typeof en

/** Japanese escalation messages. */
export const ja = {
  access: {
    'read-only': '読み取り専用のアクセス',
    'workspace-write': 'ワークスペースのファイルを変更する権限',
    'danger-full-access': 'このコンピューターへのフルアクセス',
  },
  escalation: (access: string, justification: string): string => `${access}でこの操作を許可しますか？理由：${justification}`,
} satisfies typeof en

/** Spanish dictionary, checked against the English keys. */
export const es = {
  access: {
    'read-only': 'acceso de solo lectura',
    'workspace-write': 'permiso para cambiar archivos de tu espacio de trabajo',
    'danger-full-access': 'acceso completo a tu equipo',
  },
  escalation: (access: string, justification: string): string => `¿Permitir esto con ${access}? Motivo indicado: ${justification}`,
} satisfies typeof en

/** French dictionary, checked against the English keys. */
export const fr = {
  access: {
    'read-only': 'un accès en lecture seule',
    'workspace-write': 'l’autorisation de modifier les fichiers de votre espace de travail',
    'danger-full-access': 'un accès complet à votre ordinateur',
  },
  escalation: (access: string, justification: string): string => `Autoriser ceci avec ${access} ? Raison indiquée : ${justification}`,
} satisfies typeof en

/** German dictionary, checked against the English keys. */
export const de = {
  access: {
    'read-only': 'Nur-Lese-Zugriff',
    'workspace-write': 'der Berechtigung, Dateien in Ihrem Arbeitsbereich zu ändern',
    'danger-full-access': 'vollem Zugriff auf Ihren Computer',
  },
  escalation: (access: string, justification: string): string => `Dies mit ${access} zulassen? Angegebener Grund: ${justification}`,
} satisfies typeof en

/** Russian dictionary, checked against the English keys. */
export const ru = {
  access: {
    'read-only': 'доступом только для чтения',
    'workspace-write': 'правом изменять файлы в рабочей папке',
    'danger-full-access': 'полным доступом к вашему компьютеру',
  },
  escalation: (access: string, justification: string): string => `Разрешить это действие с ${access}? Указанная причина: ${justification}`,
} satisfies typeof en

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  access: {
    'read-only': 'acesso somente leitura',
    'workspace-write': 'permissão para alterar arquivos do seu espaço de trabalho',
    'danger-full-access': 'acesso total ao seu computador',
  },
  escalation: (access: string, justification: string): string => `Permitir isto com ${access}? Motivo informado: ${justification}`,
} satisfies typeof en

/**
 * Build translations for the existing Client localized-text resolver, naming
 * the requested mode by what it lets the action do.
 * @param mode - requested sandbox mode.
 * @param justification - raw model justification, preserved in every translation.
 * @returns localized approval text.
 */
export function escalationDisplayReason(mode: SandboxMode, justification: string): Record<'en' | 'zh' | 'ja' | 'es' | 'fr' | 'de' | 'ru' | 'pt', string> {
  return {
    en: en.escalation(en.access[mode], justification),
    zh: zh.escalation(zh.access[mode], justification),
    ja: ja.escalation(ja.access[mode], justification),
    es: es.escalation(es.access[mode], justification),
    fr: fr.escalation(fr.access[mode], justification),
    de: de.escalation(de.access[mode], justification),
    ru: ru.escalation(ru.access[mode], justification),
    pt: pt.escalation(pt.access[mode], justification),
  }
}
