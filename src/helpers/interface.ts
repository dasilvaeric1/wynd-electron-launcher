import { Theme, TThemeColorTypes } from "react-antd-cssvars";

export interface IElectronAPI {
  send: (channel: string, ...args: any[]) => void;
  on: (channel: string, callback: (...args: any[]) => void) => void;
  once: (channel: string, callback: (...args: any[]) => void) => void;
  removeAllListeners: (channel: string) => void;
  setZoomLevel?: (level: number) => void;
  setZoomFactor?: (factor: number) => void;
  version?: string;
  env?: {
    NODE_ENV?: string;
    DEV?: string;
    PORT?: string;
  };
}

export interface ILogger {
  info: (...args: any[]) => void;
  debug: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  setLevel: (level: string) => void;
  level?: string;
}

export interface Hooks {}
export interface ICustomWindow extends Window {
  store: any;
  theme: Theme<TThemeColorTypes>;
  modules?: any;
  electronAPI: IElectronAPI;
  log: ILogger;
  __STATIC__?: string;
  main?: {
    send?: any;
    receive?: any;
    sendLog?: any;
    setLog?: () => any;
  };
}
