/** The service worker's own build: a file read as text with `?raw` (vite/client, for pages, declares it there). */
declare module "*?raw" {
  const content: string;
  export default content;
}
