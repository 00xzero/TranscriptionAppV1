export function getApiBase() {
  // Browser calls will target localhost API
  const url = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  return url.replace(/\/$/, '')
}

export function getApiToken() {
  return process.env.NEXT_PUBLIC_API_TOKEN || 'devtoken'
}

export function getAuthHeaders() {
  return {
    Authorization: `Bearer ${getApiToken()}`,
  }
}
