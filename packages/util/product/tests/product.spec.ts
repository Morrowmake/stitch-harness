import { describe, expect, it } from 'vitest'
import * as product from '../src/index.ts'

describe('product identity', () => {
  it('derives repository URL and env prefix consistently', () => {
    expect(product.REPOSITORY_URL).toBe(`https://github.com/${product.REPOSITORY}`)
    expect(product.ENV_PREFIX).toBe(`${product.PRODUCT_SLUG.toUpperCase()}_`)
    expect(product.HOME_DIR_NAME).toBe(`.${product.PRODUCT_SLUG}`)
    expect(product.CLI_COMMAND).toBe(product.PRODUCT_SLUG)
  })
})
