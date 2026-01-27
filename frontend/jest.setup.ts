import '@testing-library/jest-dom'

// Polyfill missing DOM APIs in jsdom
if (typeof window !== 'undefined') {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    writable: true,
    value: jest.fn(),
  })
}

// In case any code queries ResizeObserver implicitly
// @ts-ignore
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
