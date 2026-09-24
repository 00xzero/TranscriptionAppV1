const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^(\\.\\./){2,}components/AudioPlayer$': '<rootDir>/__mocks__/AudioPlayer.tsx',
    '^@/(.*)$': '<rootDir>/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^react-virtuoso$': '<rootDir>/__mocks__/react-virtuoso.tsx',
    '^@number-flow/react$': '<rootDir>/__mocks__/number-flow-react.tsx',
  },
  testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],
}

module.exports = createJestConfig(customJestConfig)
