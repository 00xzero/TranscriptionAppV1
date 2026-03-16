declare global {
  interface WindowEventMap {
    'open-find-replace': CustomEvent<void>
    'open-export': CustomEvent<void>
    'editor-scroll-to-top': CustomEvent<void>
  }
}

export {}
