declare module 'mammoth/mammoth.browser' {
  interface MammothResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  interface Mammoth {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: Record<string, unknown>): Promise<MammothResult>;
  }
  const mammoth: Mammoth;
  export default mammoth;
}
