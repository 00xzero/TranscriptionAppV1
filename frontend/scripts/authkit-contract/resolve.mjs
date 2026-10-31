// Node's ESM loader hooks for running AuthKit outside Next: Next's
// extensionless subpath imports (`next/cache`) get their `.js`, and
// `server-only` gets the empty module Next itself uses on the server.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return nextResolve('next/dist/compiled/server-only/empty.js', context)
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (/^next\/[^.]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context)
    throw error
  }
}
