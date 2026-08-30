const DEMO_PATH = "/fayaaa/media/fayaaa-demo.mp4";
const DEMO_KEY = "demos/fayaaa-demo-2026-08-30.mp4";

const demoHeaders = (object) => {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("accept-ranges", "bytes");
  headers.set("etag", object.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  return headers;
};

const serveDemo = async (request, bucket) => {
  if (request.method === "HEAD") {
    const object = await bucket.head(DEMO_KEY);
    if (object === null) return new Response("Not Found", { status: 404 });

    const headers = demoHeaders(object);
    headers.set("content-length", String(object.size));
    return new Response(null, { headers });
  }

  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }

  const hasRange = request.headers.has("range");
  let object;
  try {
    const options = hasRange ? { range: request.headers } : undefined;
    object = await bucket.get(DEMO_KEY, options);
  } catch {
    const metadata = await bucket.head(DEMO_KEY);
    const headers = new Headers({ "accept-ranges": "bytes" });
    if (metadata !== null) {
      headers.set("content-range", `bytes */${metadata.size}`);
    }
    return new Response("Range Not Satisfiable", { status: 416, headers });
  }

  if (object === null) return new Response("Not Found", { status: 404 });

  const headers = demoHeaders(object);
  let status = 200;

  if (hasRange && object.range) {
    const length = object.range.length ?? object.range.suffix ?? object.size;
    const offset = object.range.offset ?? Math.max(0, object.size - length);
    headers.set("content-length", String(length));
    headers.set(
      "content-range",
      `bytes ${offset}-${offset + length - 1}/${object.size}`,
    );
    status = 206;
  } else {
    headers.set("content-length", String(object.size));
  }

  return new Response(object.body, { status, headers });
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/fayaaa") {
      url.pathname = "/fayaaa/";
      return Response.redirect(url, 307);
    }

    if (url.pathname === DEMO_PATH) {
      return serveDemo(request, env.FAYAAA_MEDIA);
    }

    return env.ASSETS.fetch(request);
  },
};
