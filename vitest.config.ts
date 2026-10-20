import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@services': resolve(__dirname, 'src/services'),
      '@features': resolve(__dirname, 'src/features'),
      '@components': resolve(__dirname, 'src/components')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
