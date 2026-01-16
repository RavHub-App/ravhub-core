import '@testing-library/jest-dom'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Ensure DOM cleanup between tests (Vitest + Testing Library)
afterEach(() => cleanup())
