import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    // Downgrade new React 19 rules to warnings — pre-existing patterns,
    // not regressions from the Next.js 16 upgrade. Address in a follow-up.
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/globals": "warn",
      "react-hooks/purity": "warn",
    },
  },
  {
    // lib/hairline/kernel.js is vendored from @lucasmarkes/hairline, unchanged.
    ignores: ["node_modules/", ".next/", "lib/hairline/kernel.js"],
  },
];

export default config;
