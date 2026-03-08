const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^\\.\\./\\.\\./\\.\\./components/AudioPlayer$': '<rootDir>/__mocks__/AudioPlayer.tsx',
    '^react-virtuoso$': '<rootDir>/__mocks__/react-virtuoso.tsx',
  },
  testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],
}

module.exports = createJestConfig(customJestConfig)
