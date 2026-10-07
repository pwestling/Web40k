declare const __APP_BUILD__: string;

/** This app's version and commit, which covers the reducer and the built-in game modules. */
export const APP_BUILD: string = typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : "0.0.0+dev";
