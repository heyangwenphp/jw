import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

describe('welcome chat input send guard', () => {
  it('guards the home-page send path against overlapping submissions', () => {
    const mainContentSource = readSource('src/renderer/pages/main/components/MainContent.vue')
    const handleWelcomeSendBody = mainContentSource.match(/const handleWelcomeSend = async[\s\S]*?\n}/)?.[0] || ''

    expect(mainContentSource).toContain('const welcomeSendInFlight = ref(false)')
    expect(handleWelcomeSendBody).toContain('if (welcomeSendInFlight.value) return')
    expect(handleWelcomeSendBody).toContain('welcomeSendInFlight.value = true')
    expect(handleWelcomeSendBody).toContain('welcomeSendInFlight.value = false')
  })

  it('does not block the first home-page prompt on the AgentChatTab ready event', () => {
    const mainContentSource = readSource('src/renderer/pages/main/components/MainContent.vue')
    const handleWelcomeSendBody = mainContentSource.match(/const handleWelcomeSend = async[\s\S]*?\n}/)?.[0] || ''

    const getTabRefIndex = handleWelcomeSendBody.indexOf('await getAgentTabRef(sessionId)')
    const waitReadyIndex = handleWelcomeSendBody.indexOf('await waitForAgentTabReady(sessionId)')
    const sendIndex = handleWelcomeSendBody.indexOf('await tabRef.sendInitialMessage(payload)')

    expect(getTabRefIndex).toBeGreaterThan(-1)
    expect(waitReadyIndex).toBeGreaterThan(-1)
    expect(sendIndex).toBeGreaterThan(-1)
    expect(getTabRefIndex).toBeLessThan(waitReadyIndex)
    expect(waitReadyIndex).toBeLessThan(sendIndex)
    expect(handleWelcomeSendBody).toContain('if (!tabRef?.sendInitialMessage)')
  })
})
