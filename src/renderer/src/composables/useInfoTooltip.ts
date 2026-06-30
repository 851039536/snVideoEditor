import { ref, onUnmounted, type Ref } from 'vue'

/**
 * Manage a click-to-toggle info tooltip with click-outside-to-close.
 * @returns { isOpen, elRef, toggle } — bind elRef to the tooltip DOM element,
 *   call toggle on the trigger button.
 */
export function useInfoTooltip(): {
  isOpen: Ref<boolean>
  elRef: Ref<HTMLElement | null>
  toggle: () => void
} {
  const isOpen = ref(false)
  const elRef = ref<HTMLElement | null>(null)

  function onClick(e: MouseEvent): void {
    if (isOpen.value && elRef.value && !elRef.value.contains(e.target as Node)) {
      isOpen.value = false
      document.removeEventListener('click', onClick)
    }
  }

  function toggle(): void {
    isOpen.value = !isOpen.value
    if (isOpen.value) {
      // Register on next tick so current click doesn't immediately close it
      import('vue').then(({ nextTick }) => {
        nextTick(() => { document.addEventListener('click', onClick) })
      })
    } else {
      document.removeEventListener('click', onClick)
    }
  }

  onUnmounted(() => {
    document.removeEventListener('click', onClick)
  })

  return { isOpen, elRef, toggle }
}
