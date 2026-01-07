declare module 'mammoth/mammoth.browser' {
  export function convertToHtml(options: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
}
