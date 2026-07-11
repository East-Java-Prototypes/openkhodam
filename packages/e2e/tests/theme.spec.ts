import { expect, test } from '../fixtures/electron'

test('persists the selected appearance mode across reloads', async ({ appWindow }) => {
  await appWindow.getByRole('link', { name: 'Settings', exact: true }).click()

  const darkButton = appWindow.getByRole('button', { name: 'Dark', exact: true })
  const lightButton = appWindow.getByRole('button', { name: 'Light', exact: true })
  const systemButton = appWindow.getByRole('button', { name: 'System', exact: true })

  await expect(systemButton).toBeVisible()
  await expect(lightButton).toBeVisible()
  await expect(darkButton).toBeVisible()

  await darkButton.click()
  await expect(darkButton).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() => appWindow.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(true)
  await expect
    .poll(() => appWindow.evaluate(() => document.documentElement.style.colorScheme))
    .toBe('dark')

  await appWindow.reload()
  await expect(appWindow.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect
    .poll(() => appWindow.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(true)

  await appWindow.getByRole('button', { name: 'Light', exact: true }).click()
  await expect
    .poll(() => appWindow.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(false)
  await expect
    .poll(() => appWindow.evaluate(() => document.documentElement.style.colorScheme))
    .toBe('light')
})
