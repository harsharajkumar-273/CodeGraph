// `?url` asset imports (Vite): the module's default export is the asset's URL.
declare module '*.wasm?url' {
  const url: string;
  export default url;
}
