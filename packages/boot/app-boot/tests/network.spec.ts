/** Connection attempt timeout: raised to the Host floor, never lowered below a larger configured value. */
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { CONNECTION_ATTEMPT_TIMEOUT_MS, raiseConnectionAttemptTimeout } from '@deepseek-ai/dsh-app-boot'

const original = net.getDefaultAutoSelectFamilyAttemptTimeout()

afterEach(() => {
  net.setDefaultAutoSelectFamilyAttemptTimeout(original)
})

describe('raiseConnectionAttemptTimeout', () => {
  it('raises a smaller default to the Host floor', () => {
    net.setDefaultAutoSelectFamilyAttemptTimeout(250)

    expect(raiseConnectionAttemptTimeout()).toBe(CONNECTION_ATTEMPT_TIMEOUT_MS)
    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(CONNECTION_ATTEMPT_TIMEOUT_MS)
  })

  it('keeps a larger configured value', () => {
    net.setDefaultAutoSelectFamilyAttemptTimeout(5000)

    expect(raiseConnectionAttemptTimeout()).toBe(5000)
    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(5000)
  })
})
