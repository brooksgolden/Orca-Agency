import { defineFixture } from '../../component-fixtures/component-fixture'
import { ChatSidebarOptions } from './ChatSidebarOptions'

export const filters = defineFixture({
  width: 300,
  render: () => <ChatSidebarOptions />,
  interact: async (frame) => {
    const trigger = frame.querySelector('button')
    if (!trigger) {
      throw new Error('Missing sidebar options trigger')
    }
    trigger.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false })
    )
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
})
