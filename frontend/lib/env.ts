/**
 * A positive whole number from the environment, or `fallback` when the
 * variable is unset or anything else ("0", "5.5", "10abc").
 */
export function readPositiveIntEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name])
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
