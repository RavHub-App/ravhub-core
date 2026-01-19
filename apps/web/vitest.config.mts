import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/setupTests.ts'],
        css: false,
        // Exclude Playwright/e2e artifacts and any files that are intended for the e2e runner
        exclude: [
            '**/e2e/**',
            '**/*.e2e.*',
            '**/*.playwright.*',
            '**/playwright-report/**',
            '**/dist/**',
            '**/node_modules/**',
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                '**/node_modules/**',
                '**/dist/**',
                '**/e2e/**',
                '**/*.config.*',
                '**/*.d.ts',
                '**/test-utils.tsx',
                '**/setupTests.ts',
            ]
        },
    },
})
