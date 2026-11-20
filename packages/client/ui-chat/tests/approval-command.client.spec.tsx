// @vitest-environment jsdom
import type { ChatSnapshot, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApprovalCommand, argumentsOf, commandOf } from '../src/client/chat/ApprovalCommand.tsx'

function props(
  nodes: readonly unknown[],
  callId = 'call-1',
): PropsRuntime<'conversation.approval.detail'> & PropsLocale<'approval'> {
  const snapshot = {
    nodes: { values: () => nodes },
  } as unknown as ChatSnapshot
  const useChat = ((selector: (value: ChatSnapshot) => unknown) => selector(snapshot)) as UseChat
  const messages: Record<string, string> = { details: 'Details' }
  const t = ((key: string) => messages[key] ?? key) as PropsLocale<'approval'>['t']
  return { callId, useChat, t } as PropsRuntime<'conversation.approval.detail'> & PropsLocale<'approval'>
}

describe('argumentsOf', () => {
  it('indents JSON arguments, keeps non-JSON text, and omits empty arguments', () => {
    expect(argumentsOf('{"action":"install_bundle","target":"/tmp/hello"}')).toBe('{\n  "action": "install_bundle",\n  "target": "/tmp/hello"\n}')
    expect(argumentsOf('not json')).toBe('not json')
    expect(argumentsOf('{}')).toBeUndefined()
    expect(argumentsOf('  ')).toBeUndefined()
  })
})

describe('ApprovalCommand details', () => {
  it('keeps the raw arguments of a call without a command behind a collapsed Details disclosure', () => {
    const argsRaw = '{"action":"install_bundle","target":"/tmp/hello-command"}'
    const { container } = render(<ApprovalCommand {...props([
      { kind: 'tool-call', data: { root: { phase: 'start', args: PartialArguments.fromText(argsRaw), callId: 'call-1', name: 'plugin_manager', argsRaw } } },
    ] as never)} />)

    const details = container.querySelector('details')
    expect(details?.open).toBe(false)
    expect(screen.getByText('Details').tagName).toBe('SUMMARY')
    expect(details?.querySelector('pre')?.textContent).toBe('{\n  "action": "install_bundle",\n  "target": "/tmp/hello-command"\n}')
  })
})

describe('commandOf', () => {
  it('accepts only a non-empty string command from valid JSON arguments', () => {
    expect(commandOf(undefined)).toBeUndefined()
    expect(commandOf({ callId: 'c1', name: 'bash', argsRaw: '{' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', name: 'bash', argsRaw: '{}' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', name: 'bash', argsRaw: '{"command":42}' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', name: 'bash', argsRaw: '{"command":""}' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', name: 'bash', argsRaw: '{"command":"pnpm test"}' })).toBe('pnpm test')
  })

  it('reads the text typed into a terminal as its command', () => {
    expect(commandOf({ callId: 'c1', name: 'terminal_send', argsRaw: '{"sessionId":"pty-1","text":"pnpm run dev"}' })).toBe('pnpm run dev')
    expect(commandOf({ callId: 'c1', name: 'terminal_send', argsRaw: '{"sessionId":"pty-1","text":"","submit":true}' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', name: 'write', argsRaw: '{"path":"notes.md","text":"draft"}' })).toBeUndefined()
  })
})

describe('ApprovalCommand', () => {
  it('renders the running correlated Tool command', () => {
    render(<ApprovalCommand {...props([
      { kind: 'assistant-step', data: {} },
      { kind: 'tool-call', data: { root: { phase: 'start', args: PartialArguments.fromText('{"command":"wrong"}'), callId: 'other', name: 'bash', argsRaw: '{"command":"wrong"}' } } },
      { kind: 'tool-call', data: { root: { phase: 'start', args: PartialArguments.fromText('{"command":"pnpm test"}'), callId: 'call-1', name: 'bash', argsRaw: '{"command":"pnpm test"}' } } },
    ] as never)} />)

    expect(screen.getByText('pnpm test')).toBeTruthy()
  })

  it('omits absent, uncorrelated, preparing, and settled Tool calls', () => {
    const { container, rerender } = render(<ApprovalCommand {...props([
      { kind: 'assistant-step', data: {} },
      { kind: 'tool-call', data: { root: undefined } },
      { kind: 'tool-call', data: { root: { phase: 'start', args: PartialArguments.fromText('{}'), callId: 'other', argsRaw: '{}' } } },
      { kind: 'tool-call', data: { root: { phase: 'preparing', args: PartialArguments.EMPTY, callId: 'call-1', name: 'bash' } } },
      {
        kind: 'tool-call',
        data: { root: { kind: 'tool-result', callId: 'call-1', argsRaw: '{"command":"ignored"}' } },
      },
    ] as never)} />)
    expect(container.textContent).toBe('')

    rerender(<ApprovalCommand {...props([
      { kind: 'tool-call', data: { root: { phase: 'start', args: PartialArguments.fromText('{}'), callId: 'call-1', argsRaw: '{}' } } },
    ] as never)} />)
    expect(container.textContent).toBe('')
  })
})
