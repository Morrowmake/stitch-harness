/** Generated short prompt: the `<tools>` and `<rules>` blocks built from mounted tools' short-prompt contributions. @module */

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** First sentence of a description, without its final period, for tools that declare no summary. */
function firstSentence(description: string): string {
  const line = description.trim().split('\n', 1)[0] ?? ''
  const end = /[.!?](?:\s|$)/.exec(line)
  const sentence = end === null ? line : line.slice(0, end.index + 1)
  return sentence.replace(/\.$/, '').trim()
}

/** Order by declared placement, then by code-unit name; tools without a placement follow. */
function compareTools(a: ToolDefinition, b: ToolDefinition): number {
  const left = a.shortPrompt?.order ?? Number.POSITIVE_INFINITY
  const right = b.shortPrompt?.order ?? Number.POSITIVE_INFINITY
  if (left !== right) return left < right ? -1 : 1
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

/**
 * Render the `<tools>` list and `<rules>` list for the mounted tools.
 * @param definitions - the tools visible in the assembling scope.
 * @param closingRules - the persona's own rules, after every tool's rules.
 * @returns the two blocks separated by a blank line.
 */
export function renderShortPrompt(definitions: readonly ToolDefinition[], closingRules: readonly string[]): string {
  const tools = [...definitions].sort(compareTools)
  const mounted = new Set(tools.map(tool => tool.name))
  // Tools with an identical summary share the line of the first of them.
  const lines = new Map<string, string[]>()
  for (const tool of tools) {
    const summary = tool.shortPrompt?.summary ?? firstSentence(tool.description)
    const names = lines.get(summary)
    if (names === undefined) lines.set(summary, [tool.name])
    else names.push(tool.name)
  }
  const rules = new Set<string>()
  for (const tool of tools) {
    for (const rule of tool.shortPrompt?.rules ?? []) {
      if (typeof rule === 'string') rules.add(rule)
      else if ((rule.when ?? []).every(name => mounted.has(name)) && !(rule.unless ?? []).some(name => mounted.has(name))) {
        rules.add(rule.text)
      }
    }
  }
  for (const rule of closingRules) rules.add(rule)
  return [
    '<tools>',
    ...[...lines].map(([summary, names]) => `- ${names.join(' / ')}: ${summary}`),
    '',
    'Additional tools may be available.',
    '</tools>',
    '',
    '<rules>',
    ...[...rules].map(rule => `- ${rule}`),
    '</rules>',
  ].join('\n')
}

/**
 * Long guidance sections the mounted tools' short contributions replace.
 * @param definitions - the tools visible in the assembling scope.
 * @returns the section names to leave out of the short prompt.
 */
export function replacedSections(definitions: readonly ToolDefinition[]): Set<string> {
  const names = new Set<string>()
  for (const tool of definitions) {
    if (tool.shortPrompt === undefined) continue
    for (const name of tool.shortPrompt.replaces ?? [`tool:${tool.name}`]) names.add(name)
  }
  return names
}
