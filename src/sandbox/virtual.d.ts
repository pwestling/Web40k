declare module "virtual:sandbox-worker" {
  /** The sandbox worker bundled as one ES module (vite.config.ts). */
  const source: string;
  export default source;
}

declare module "virtual:soak-worker" {
  /** The module workshop's soak bot, bundled as one script (vite.config.ts). */
  const source: string;
  export default source;
}

declare module "virtual:sdk-types" {
  /** The SDK's declarations and the ES lib files, by path, for the workshop's type checker (vite.config.ts). */
  const files: Record<string, string>;
  export default files;
}
