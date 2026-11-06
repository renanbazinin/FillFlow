import { expect, test } from '@playwright/test'
import { clickPagePoint, downloadPdf, fixture, gotoHome, openPdf, selectTool, showPage, typeAndCommit } from './support/app'
import { readPageText, readViewSizes } from './support/pdf'

const ROTATED = fixture('rotated.pdf')
/** The "A" crosshair printed on every page of rotated.pdf (view space). */
const TARGET = { x: 72, y: 180 }

test('text lands where it was placed on rotated and cropped pages', async ({ page }) => {
  const sizes = await readViewSizes(ROTATED)
  expect(sizes).toHaveLength(4)

  await gotoHome(page)
  await openPdf(page, ROTATED)
  await showPage(page, 0)

  for (let i = 0; i < sizes.length; i++) {
    await selectTool(page, 'Text', 'T')
    await clickPagePoint(page, i, TARGET, sizes[i])
    await typeAndCommit(page, `Marker ${i + 1}`)
  }

  const { bytes } = await downloadPdf(page)

  for (let i = 0; i < sizes.length; i++) {
    const runs = await readPageText(bytes, i)
    const marker = runs.find((t) => t.str.includes(`Marker ${i + 1}`))
    expect(marker, `"Marker ${i + 1}" on page ${i + 1}`).toBeTruthy()
    if (!marker) continue
    // Upright as displayed, left to right…
    expect(marker.direction.x, `direction on page ${i + 1}`).toBeCloseTo(1, 2)
    expect(marker.direction.y, `direction on page ${i + 1}`).toBeCloseTo(0, 2)
    // …starting where it was clicked: the baseline sits at, or a line below, the click.
    expect(Math.abs(marker.x - TARGET.x), `x on page ${i + 1}`).toBeLessThan(20)
    expect(marker.y - TARGET.y, `baseline on page ${i + 1}`).toBeGreaterThan(-8)
    expect(marker.y - TARGET.y, `baseline on page ${i + 1}`).toBeLessThan(28)
    // Nothing leaked onto other pages.
    for (let j = 0; j < sizes.length; j++) {
      if (j === i) continue
      const other = await readPageText(bytes, j)
      expect(other.some((t) => t.str.includes(`Marker ${i + 1}`)), `"Marker ${i + 1}" on page ${j + 1}`).toBe(false)
    }
  }
})
