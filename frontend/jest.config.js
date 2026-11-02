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
    // AuthKit ships ESM only, which Jest's CommonJS resolver cannot load.
    '^@workos-inc/authkit-nextjs$': '<rootDir>/__mocks__/workos-authkit-nextjs.ts',
    '^@workos-inc/authkit-nextjs/components$': '<rootDir>/__mocks__/workos-authkit-nextjs-components.tsx',
    // Next swaps `server-only` for an empty module on the server; tests run there too.
    '^server-only$': 'next/dist/compiled/server-only/empty',
  },
  testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],
}

const resolveJestConfig = createJestConfig(customJestConfig)

module.exports = async () => {
  const config = await resolveJestConfig()
  return {
    ...config,
    // next/jest prepends its own ignore patterns, so adjust the resolved config
    // to transform the ESM sealing packages while keeping its other exclusions.
    transformIgnorePatterns: config.transformIgnorePatterns.map((pattern) =>
      pattern.replace(
        '/node_modules/',
        '/node_modules/(?!(iron-session|iron-webcrypto|cookie|uint8array-extras)/)'
      )
    ),
  }
}
