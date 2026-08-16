/**
 * 平台桥：区分 Electron 与纯浏览器环境，声明 preload 暴露的 API 类型。
 */

export interface SerialPortInfo {
  path: string;
  friendlyName?: string;
}

export interface QrintSerialApi {
  available: boolean;
  list(): Promise<SerialPortInfo[]>;
  open(path: string, baud: number): Promise<void>;
  write(data: ArrayBuffer): Promise<void>;
  read(n: number, timeoutMs: number): Promise<ArrayBuffer>;
  flush(): Promise<void>;
  close(): Promise<void>;
  isOpen(): Promise<boolean>;
}

export interface QrintLogApi {
  append(line: string): void;
}

declare global {
  interface Window {
    qrintSerial?: QrintSerialApi;
    qrintLog?: QrintLogApi;
  }
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.qrintSerial?.available;
}
