// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TextInput } from 'react-native'
import { afterEach, expect, it, vi } from 'vitest'
import { MobileSessionCommandDock } from './MobileSessionCommandDock'
import { useTerminalLiveInputFocus } from '../terminal/use-terminal-live-input-focus'

vi.mock('react-native', async () => {
  const React = await import('react')
  const View = (props: { children?: React.ReactNode; 'aria-hidden'?: boolean }) =>
    React.createElement('div', { 'aria-hidden': props['aria-hidden'] }, props.children)
  return {
    View,
    Pressable: View,
    TextInput: React.forwardRef(
      (
        props: {
          accessibilityLabel?: string
          defaultValue?: string
          onChange?: (event: { nativeEvent: { text: string; inputType?: string } }) => void
          placeholder?: string
          tabIndex?: number
          value?: string
        },
        ref
      ) => {
        const node = React.useRef<HTMLInputElement>(null)
        React.useImperativeHandle(ref, () => ({
          focus: () => node.current?.focus(),
          blur: () => node.current?.blur(),
          isFocused: () => document.activeElement === node.current
        }))
        return React.createElement('input', {
          ref: node,
          'aria-label': props.accessibilityLabel,
          defaultValue: props.defaultValue,
          placeholder: props.placeholder,
          tabIndex: props.tabIndex,
          value: props.value,
          onInput: (event: {
            currentTarget: HTMLInputElement
            nativeEvent: { inputType?: string }
          }) =>
            props.onChange?.({
              nativeEvent: {
                text: event.currentTarget.value,
                inputType: event.nativeEvent.inputType
              }
            })
        })
      }
    ),
    Platform: { OS: 'web', select: (values: { default: unknown }) => values.default },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
  }
})
// The key row and its sheet are out of scope; the rail holding the keys leaves just the two fields.
vi.mock('./use-session-terminal-key-rail', () => ({
  useSessionTerminalKeyRail: () => ({
    keysInRail: true,
    moreKeysVisible: false,
    closeMoreKeys: () => {}
  })
}))
vi.mock('./MobileTerminalMoreKeysSheet', () => ({ MobileTerminalMoreKeysSheet: () => null }))
vi.mock('./MobileTerminalInputActions', () => ({
  MobileTerminalInputActions: () => null,
  MobileTerminalAttachButton: () => null,
  MobileTerminalDictationButton: () => null
}))
vi.mock('../components/composer-input/MessageBox', async () => {
  const React = await import('react')
  const { TextInput } = await import('react-native')
  const Input: React.ElementType = TextInput
  return {
    MessageBox: ({
      inputRef,
      placeholder,
      tabIndex
    }: {
      inputRef: React.Ref<unknown>
      placeholder?: string
      tabIndex?: number
    }) => React.createElement(Input, { ref: inputRef, placeholder, tabIndex })
  }
})
vi.mock('../components/composer-input/ComposerSendButton', () => ({
  ComposerSendButton: () => null
}))
vi.mock('./native-chat/input/MobileNativeChatStopButton', () => ({
  MobileNativeChatStopButton: () => null
}))
vi.mock('./MobileTerminalLiveInputStatus', () => ({ MobileTerminalLiveInputStatus: () => null }))
vi.mock('./MobileTerminalCommandDictationPreview', () => ({
  MobileTerminalCommandDictationPreview: () => null
}))
vi.mock('./MobileSessionAccessoryKeys', () => ({ MobileSessionAccessoryKeys: () => null }))
vi.mock('../platform/host-os', () => ({ hostOs: () => 'ios' }))

type Selection = {
  handle: string
  liveInputEnabled: boolean
  deferLiveInputCapture?: boolean
  onLiveInputType?: (inputType?: string) => void
}
let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  vi.useRealTimers()
})

function Harness({
  handle,
  liveInputEnabled,
  deferLiveInputCapture = false,
  onLiveInputType
}: Selection) {
  const [liveInputCapture, setLiveInputCapture] = useState('')
  const [, forceRender] = useState(0)
  const liveInputRef = useRef<TextInput>(null)
  const commandInputRef = useRef<TextInput>(null)
  const activeHandleRef = useRef(handle)
  useLayoutEffect(() => {
    activeHandleRef.current = handle
  }, [handle])
  useTerminalLiveInputFocus({
    activeHandleRef,
    inputRef: liveInputRef,
    commandInputRef,
    canSend: true,
    keyboardHeight: 0,
    lifecycleIdentity: null,
    lifecycleKey: 'host:workspace:connected',
    liveInputEnabled,
    reopenFocusedInputWhenKeyboardHidden: false,
    timerRef: useRef(null)
  })
  const controller = {
    insets: { bottom: 0 },
    bufferedTerminalDraftState: { input: '', setInput: () => {} },
    liveInputCapture,
    handleLiveInputChange: (event: { nativeEvent: { text: string; inputType?: string } }) => {
      onLiveInputType?.(event.nativeEvent.inputType)
      if (deferLiveInputCapture) {
        const text = event.nativeEvent.text
        // A slow state mirror lets an unrelated render run first with stale capture text.
        setTimeout(() => setLiveInputCapture(text), 50)
        forceRender((revision) => revision + 1)
      } else {
        setLiveInputCapture(event.nativeEvent.text)
      }
    },
    liveInputEnabled,
    canSend: true,
    canCompose: true,
    dictation: { meter: null },
    commandFieldAnchorRef: { current: null },
    activeHandle: handle,
    activeSessionTab: null,
    dockKeys: { interceptTypedCharacter: () => false },
    keyboardLift: 0,
    liveInputRef,
    commandInputRef,
    bindLiveInputField: (field: TextInput | null) => {
      liveInputRef.current = field
    }
  }
  return createElement(MobileSessionCommandDock, {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the real dock reads these fields; action children are inert and no send/dictation handler is invoked.
    controller: controller as unknown as Parameters<
      typeof MobileSessionCommandDock
    >[0]['controller']
  })
}

it.each(['terminal selection', 'preference hydration'] as const)(
  'keeps focus on the visible retained field after %s, leaving a closed keyboard alone',
  (transition) => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const render = (liveInputEnabled: boolean) =>
      act(() =>
        root?.render(
          createElement(Harness, {
            handle:
              liveInputEnabled && transition === 'terminal selection' ? 'terminal-b' : 'terminal-a',
            liveInputEnabled
          })
        )
      )
    render(false)
    const command = container.querySelector('input[placeholder="Write a command, then send"]')
    const live = container.querySelector('input[aria-label="Live terminal input"]')
    if (!(command instanceof HTMLInputElement) || !(live instanceof HTMLInputElement)) {
      throw new Error('Both dock fields must be mounted')
    }
    command.focus()

    render(true)
    expect(document.activeElement).toBe(live)
    expect(live.closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe('false')
    render(false)
    expect(document.activeElement).toBe(command)
    expect(command.closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe('false')
    expect(container.querySelector('input[aria-label="Live terminal input"]')).toBe(live)

    command.blur()
    render(true)
    render(false)
    expect(document.activeElement).toBe(document.body)
    expect(vi.getTimerCount()).toBe(0)
  }
)

it('keeps a long native paste through onChange and a stale then updated React render', () => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  let capturedInputType: string | undefined
  act(() =>
    root?.render(
      createElement(Harness, {
        handle: 'terminal-a',
        liveInputEnabled: true,
        deferLiveInputCapture: true,
        onLiveInputType: (inputType) => {
          capturedInputType = inputType
        }
      })
    )
  )

  const live = container.querySelector('input[aria-label="Live terminal input"]')
  if (!(live instanceof HTMLInputElement)) {
    throw new Error('Live input must be mounted')
  }
  const pasted = 'Long mobile paste '.repeat(2_000)
  live.value = pasted
  act(() => {
    live.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }))
  })

  expect(capturedInputType).toBe('insertFromPaste')
  // The handler's immediate state update rerenders with old capture text before the delayed mirror lands.
  expect(live.value).toBe(pasted)

  act(() => {
    vi.advanceTimersByTime(50)
  })

  expect(live.value).toBe(pasted)
})
