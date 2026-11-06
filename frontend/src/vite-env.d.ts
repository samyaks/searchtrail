/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** "off" turns the MSW mocks off in development. */
  readonly VITE_API_MOCKS?: string;
}
