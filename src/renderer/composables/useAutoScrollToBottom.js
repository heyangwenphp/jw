import { ref, watch, nextTick } from 'vue'

export const getScrollPositionState = (el, {
  topThreshold = 8,
  bottomThreshold = 60
} = {}) => {
  if (!el) {
    return {
      atTop: true,
      atBottom: true,
      canScroll: false
    }
  }

  const scrollTop = Math.max(0, Number(el.scrollTop) || 0)
  const scrollHeight = Math.max(0, Number(el.scrollHeight) || 0)
  const clientHeight = Math.max(0, Number(el.clientHeight) || 0)
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight)

  return {
    atTop: scrollTop <= topThreshold,
    atBottom: maxScrollTop - scrollTop < bottomThreshold,
    canScroll: maxScrollTop > topThreshold
  }
}

export function useAutoScrollToBottom({
  containerRef,
  anchorRef,
  itemsRef,
  streamingTextRef,
  isStreamingRef,
  topThreshold = 8,
  bottomThreshold = 60,
  scrollThrottleMs = 100
}) {
  const userAtTop = ref(true)
  const userAtBottom = ref(true)
  const canScroll = ref(false)
  let scrollMutationObserver = null
  let pendingScrollFrame = null
  let lastScrollTime = 0

  const updateScrollPositionState = () => {
    const state = getScrollPositionState(containerRef.value, {
      topThreshold,
      bottomThreshold
    })
    userAtTop.value = state.atTop
    userAtBottom.value = state.atBottom
    canScroll.value = state.canScroll
    return state
  }

  const checkIfAtBottom = () => updateScrollPositionState().atBottom

  const onContainerScroll = () => {
    updateScrollPositionState()
  }

  const scrollToBottom = (instant = false, force = false) => {
    if (!force && !userAtBottom.value) return

    if (pendingScrollFrame !== null) {
      cancelAnimationFrame(pendingScrollFrame)
      pendingScrollFrame = null
    }

    nextTick(() => {
      pendingScrollFrame = requestAnimationFrame(() => {
        if (anchorRef.value) {
          anchorRef.value.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'end' })
        } else if (containerRef.value) {
          containerRef.value.scrollTo({
            top: containerRef.value.scrollHeight,
            behavior: instant ? 'auto' : 'smooth'
          })
        }
        userAtTop.value = false
        userAtBottom.value = true
        updateScrollPositionState()
        pendingScrollFrame = null
      })
    })
  }

  const scrollToTop = (instant = false) => {
    if (pendingScrollFrame !== null) {
      cancelAnimationFrame(pendingScrollFrame)
      pendingScrollFrame = null
    }

    nextTick(() => {
      pendingScrollFrame = requestAnimationFrame(() => {
        containerRef.value?.scrollTo({
          top: 0,
          behavior: instant ? 'auto' : 'smooth'
        })
        userAtTop.value = true
        userAtBottom.value = false
        updateScrollPositionState()
        pendingScrollFrame = null
      })
    })
  }

  const handleDeferredContentLoad = () => {
    scrollToBottom(true)
    updateScrollPositionState()
  }

  const startAutoScrollObservers = () => {
    const el = containerRef.value
    if (!el) return

    if (typeof MutationObserver !== 'undefined') {
      scrollMutationObserver?.disconnect()
      scrollMutationObserver = new MutationObserver(() => {
        scrollToBottom(true)
      })
      scrollMutationObserver.observe(el, {
        childList: true,
        subtree: true,
        characterData: true
      })
    }

    el.addEventListener('load', handleDeferredContentLoad, true)
    updateScrollPositionState()
  }

  const stopAutoScrollObservers = () => {
    if (pendingScrollFrame !== null) {
      cancelAnimationFrame(pendingScrollFrame)
      pendingScrollFrame = null
    }

    scrollMutationObserver?.disconnect()
    scrollMutationObserver = null

    containerRef.value?.removeEventListener('load', handleDeferredContentLoad, true)
  }

  watch(() => itemsRef.value.length, () => {
    scrollToBottom(Boolean(isStreamingRef?.value))
    nextTick(updateScrollPositionState)
  })

  if (streamingTextRef) {
    watch(streamingTextRef, () => {
      if (!userAtBottom.value) return

      const now = Date.now()
      if (now - lastScrollTime >= scrollThrottleMs) {
        lastScrollTime = now
        scrollToBottom(true)
      }
    })
  }

  return {
    userAtTop,
    userAtBottom,
    canScroll,
    updateScrollPositionState,
    checkIfAtBottom,
    onContainerScroll,
    scrollToTop,
    scrollToBottom,
    startAutoScrollObservers,
    stopAutoScrollObservers
  }
}
