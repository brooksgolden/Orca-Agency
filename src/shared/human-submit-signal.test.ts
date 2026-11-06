import { describe, expect, it } from 'vitest'
import { createHumanSubmitTracker } from './human-submit-signal'

describe('createHumanSubmitTracker', () => {
  it('counts typed text followed by Enter as a human message', () => {
    const tracker = createHumanSubmitTracker()
    expect(tracker.observe('h', true)).toBe(false)
    expect(tracker.observe('i', true)).toBe(false)
    expect(tracker.observe('\r', true)).toBe(true)
  })

  it('does not count typing without submitting', () => {
    const tracker = createHumanSubmitTracker()
    expect(tracker.observe('hello', true)).toBe(false)
  })

  it('does not count an empty Enter', () => {
    const tracker = createHumanSubmitTracker()
    expect(tracker.observe('\r', true)).toBe(false)
  })

  it('does not count programmatic or query-reply input', () => {
    const tracker = createHumanSubmitTracker()
    expect(tracker.observe('ship it\r', false)).toBe(false)
    expect(tracker.observe('\u001b[?1;2c\r', false)).toBe(false)
  })

  it('does not count escape keys or focus reports as typed text', () => {
    const tracker = createHumanSubmitTracker()
    expect(tracker.observe('\u001b[A', true)).toBe(false)
    expect(tracker.observe('\u001b[I\r', true)).toBe(false)
  })

  it('requires new typed text after each submit', () => {
    const tracker = createHumanSubmitTracker()
    expect(tracker.observe('ok\r', true)).toBe(true)
    expect(tracker.observe('\r', true)).toBe(false)
  })
})
