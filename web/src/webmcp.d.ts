// public/webmcp.js が置くグローバルなクラス（必要な部分だけ）
declare class WebMCP {
  constructor(options?: { inactivityTimeout?: number; color?: string });
  isConnected: boolean;
  registerTool(name: string, description: string, schema: object, execute: (args: any) => unknown): void;
}
