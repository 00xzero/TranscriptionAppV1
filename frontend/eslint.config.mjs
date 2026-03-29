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
    },
  },
  {
    ignores: ["node_modules/", ".next/"],
  },
];

export default config;
