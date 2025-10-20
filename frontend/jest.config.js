const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^wavesurfer\\.js$': '<rootDir>/__mocks__/wavesurfer.js',
  },
  testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],
}

module.exports = createJestConfig(customJestConfig)
