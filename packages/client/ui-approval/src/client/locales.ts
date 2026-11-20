/** `approval` namespace dictionaries. */

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  waiting: '等待审批',
  'detail.aria': '审批详情',
  escalation: '工具 {toolName} 请求越权执行',
  reject: '拒绝',
  allow: '允许',
  allowOnce: '允许一次',
  allowForChat: '本对话内允许',
  allowAlways: '始终允许',
  details: '详细信息',
} satisfies Record<string, string>

/** Approval dictionary key union. */
export type ApprovalKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  waiting: 'Waiting for approval',
  'detail.aria': 'Approval details',
  escalation: 'Tool {toolName} requests privileged execution',
  reject: 'Deny',
  allow: 'Allow',
  allowOnce: 'Allow once',
  allowForChat: 'Allow for this chat',
  allowAlways: 'Always allow',
  details: 'Details',
} satisfies Record<ApprovalKey, string>

/** Japanese copy, checked against the English keys. */
export const ja = {
  'waiting': '承認待ち',
  'detail.aria': '承認の詳細',
  'escalation': 'ツール {toolName} が特権実行を要求しています',
  'reject': '拒否',
  'allow': '許可',
  'allowOnce': '1 回だけ許可',
  'allowForChat': 'このチャットでは許可',
  'allowAlways': '常に許可',
  'details': '詳細',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  waiting: 'Esperando aprobación',
  'detail.aria': 'Detalles de aprobación',
  escalation: 'La herramienta {toolName} solicita ejecución privilegiada',
  reject: 'Denegar',
  allow: 'Permitir',
  allowOnce: 'Permitir una vez',
  allowForChat: 'Permitir en este chat',
  allowAlways: 'Permitir siempre',
  details: 'Detalles',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  waiting: "En attente d'approbation",
  'detail.aria': "Détails de l'approbation",
  escalation: "L'outil {toolName} demande une exécution privilégiée",
  reject: 'Refuser',
  allow: 'Autoriser',
  allowOnce: 'Autoriser une fois',
  allowForChat: 'Autoriser pour cette discussion',
  allowAlways: 'Toujours autoriser',
  details: 'Détails',
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  waiting: 'Warten auf Genehmigung',
  'detail.aria': 'Einzelheiten zur Genehmigung',
  escalation: 'Tool {toolName} fordert privilegierte Ausführung an',
  reject: 'Ablehnen',
  allow: 'Erlauben',
  allowOnce: 'Einmal zulassen',
  allowForChat: 'In diesem Chat zulassen',
  allowAlways: 'Immer zulassen',
  details: 'Details',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  waiting: 'Ожидание одобрения',
  'detail.aria': 'Детали утверждения',
  escalation: 'Инструмент {toolName} запрашивает привилегированное выполнение',
  reject: 'Запретить',
  allow: 'Разрешить',
  allowOnce: 'Разрешить один раз',
  allowForChat: 'Разрешить в этом чате',
  allowAlways: 'Всегда разрешать',
  details: 'Подробности',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  waiting: 'Aguardando aprovação',
  'detail.aria': 'Detalhes de aprovação',
  escalation: 'A ferramenta {toolName} solicita execução privilegiada',
  reject: 'Negar',
  allow: 'Permitir',
  allowOnce: 'Permitir uma vez',
  allowForChat: 'Permitir neste chat',
  allowAlways: 'Sempre permitir',
  details: 'Detalhes',
} satisfies Record<keyof typeof en, string>
