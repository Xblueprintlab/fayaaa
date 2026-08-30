const baseUrl = import.meta.env.BASE_URL;

export const appPath = baseUrl === "/" ? "/" : baseUrl.replace(/\/$/, "");

export function assetUrl(path: string): string {
  return `${baseUrl}${path.replace(/^\/+/, "")}`;
}
